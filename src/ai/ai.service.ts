// AI assistant on the Gemini API: content plan, captions, rewriting, hashtags.
//   quota per user per month (plan or team setting); a content plan costs 3 units, the rest 1
//   identical requests are answered from an in-memory cache and cost nothing
//   at most 6 Gemini calls at once; one call per user at a time
//   usage (requests, successes, tokens) is summed per day and kind for the admin statistics
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { ProjectsService } from '../projects/projects.service';
import { ByteLFU } from '../common/cache';
import { ApiError } from '../common/errors';
import { conf } from '../common/config';
import { dayKey, monthKey } from '../common/time';
import { KINDS, PLATFORMS, str } from '../common/constants';

const COST: Record<string, number> = { plan: 3, caption: 1, improve: 1, hashtags: 1 };
const MAX_PARALLEL = 6;
const SYSTEM =
  'Sen tajribali SMM strateg va kopirayterisan. O‘zbek tilida (lotin yozuvida), aniq, jonli va sotuvchi uslubda yozasan. ' +
  'Emoji kam va o‘rinli ishlatiladi. Hech qachon izoh yoki kirish so‘zi qo‘shmaysan — faqat so‘ralgan natijani berasan.';

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    posts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          day: { type: 'INTEGER' },
          time: { type: 'STRING' },
          platform: { type: 'STRING', enum: PLATFORMS },
          kind: { type: 'STRING', enum: KINDS },
          title: { type: 'STRING' },
          body: { type: 'STRING' },
        },
        required: ['day', 'platform', 'kind', 'title', 'body'],
      },
    },
  },
  required: ['posts'],
};

type Task = { prompt: string; schema?: object; parse: (text: string) => any };

@Injectable()
export class AiService {
  private readonly logger = new Logger('AI');
  private cache = new ByteLFU<any>(8 * 2 ** 20);
  private busy = new Set<number>();
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(private prisma: PrismaService, private billing: BillingService, private projects: ProjectsService) {}

  private record(kind: string, r: { ok?: number; cached?: number; tin?: number; tout?: number }) {
    const { ok = 0, cached = 0, tin = 0, tout = 0 } = r;
    return this.prisma.$executeRaw`
      INSERT INTO "AiDaily"(day, kind, req, ok, cached, tin, tout) VALUES (${dayKey()}, ${kind}, 1, ${ok}, ${cached}, ${tin}, ${tout})
      ON CONFLICT (day, kind) DO UPDATE SET req = "AiDaily".req + 1, ok = "AiDaily".ok + EXCLUDED.ok, cached = "AiDaily".cached + EXCLUDED.cached,
        tin = "AiDaily".tin + EXCLUDED.tin, tout = "AiDaily".tout + EXCLUDED.tout`.catch((e) => this.logger.error(e.message));
  }

  private async slot() {
    if (this.running >= MAX_PARALLEL) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
  }
  private release() {
    this.running--;
    this.waiting.shift()?.();
  }

  private async gemini(prompt: string, schema?: object) {
    const { geminiKey, geminiModel } = conf();
    const generationConfig: any = { temperature: 0.85, maxOutputTokens: 6000 };
    if (schema) Object.assign(generationConfig, { responseMimeType: 'application/json', responseSchema: schema });
    if (/2\.5-flash/.test(geminiModel)) generationConfig.thinkingConfig = { thinkingBudget: 0 }; // faster and cheaper for copywriting
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
      signal: AbortSignal.timeout(60_000),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `Gemini ${res.status}`);
    const text = (j.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    if (!text) throw new Error(`empty answer (${j.candidates?.[0]?.finishReason || 'no candidates'})`);
    const u = j.usageMetadata || {};
    return { text, tin: u.promptTokenCount || 0, tout: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
  }

  private task(kind: string, b: any, projectName: string): Task {
    if (kind === 'plan') {
      const days = [7, 14, 30].includes(Number(b.days)) ? Number(b.days) : 7;
      const start = /^\d{4}-\d{2}-\d{2}$/.test(b.start || '') ? b.start : dayKey();
      const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p: string) => PLATFORMS.includes(p));
      const perWeek = Math.min(21, Math.max(1, Number(b.perWeek) || 5));
      const count = Math.min(40, Math.max(1, Math.round((perWeek * days) / 7)));
      return {
        prompt:
          `Loyiha: «${projectName}».\nBrif: ${str(b.brief, 1500) || 'umumiy brend kontenti'}\n` +
          `Platformalar: ${(platforms.length ? platforms : ['instagram', 'telegram']).join(', ')}.\n` +
          `${days} kunlik kontent reja tuz: jami ${count} ta post, kunlarga tekis taqsimla (day = 1..${days}). ` +
          'Formatlarni aralashtir (reels, carousel, story, post). Har biri uchun: qisqa sarlavha (title) va ' +
          'tayyor matn/ssenariy (body, 300–700 belgi, oxirida chaqiriq). time — auditoriya eng faol vaqt (HH:MM).',
        schema: PLAN_SCHEMA,
        parse: (text) => {
          const out = JSON.parse(text).posts || [];
          const base = Date.parse(`${start}T00:00:00Z`);
          return {
            posts: out.slice(0, 40).map((p: any) => ({
              date: new Date(base + (Math.min(days, Math.max(1, p.day | 0)) - 1) * 86_400_000).toISOString().slice(0, 10),
              time: /^\d{2}:\d{2}$/.test(p.time || '') ? p.time : '',
              platform: PLATFORMS.includes(p.platform) ? p.platform : 'instagram',
              kind: KINDS.includes(p.kind) ? p.kind : 'post',
              title: str(p.title, 200) || 'Post',
              body: str(p.body, 8000),
              status: 'idea',
            })),
          };
        },
      };
    }
    const plain = (text: string) => ({ text: text.replace(/^```\w*\n?|```$/g, '').trim() });
    if (kind === 'caption')
      return {
        prompt:
          `Loyiha: «${projectName}». Platforma: ${str(b.platform, 20) || 'instagram'}, format: ${str(b.format, 20) || 'post'}.\n` +
          `Mavzu: ${str(b.title, 300)}\n${b.brief ? `Qo‘shimcha: ${str(b.brief, 1500)}\n` : ''}` +
          'Shu post uchun tayyor matn yoz: kuchli birinchi qator (hook), asosiy qism, chaqiriq (CTA). Reels/video bo‘lsa — qisqa ssenariy (kadrlar bilan).',
        parse: plain,
      };
    if (kind === 'improve')
      return { prompt: `Quyidagi matnni ${str(b.tone, 40) || 'jonliroq va ishonarliroq'} qilib qayta yoz, ma’nosini saqla, uzunligi taxminan bir xil bo‘lsin:\n\n${str(b.text, 6000)}`, parse: plain };
    if (kind === 'hashtags')
      return { prompt: `${str(b.platform, 20) || 'Instagram'} uchun shu postga 12–18 ta mos heshteg ber (o‘zbekcha, ruscha va inglizcha aralash, bitta qatorda, faqat heshteglar):\n\n${str(b.text, 3000)}`, parse: plain };
    throw new ApiError(400, 'Noma’lum AI so‘rovi');
  }

  async run(uid: number, b: any) {
    if (!conf().geminiKey) throw new ApiError(503, 'AI hozircha o‘chirilgan');
    const kind = String(b.kind || '');
    const cost = COST[kind];
    if (!cost) throw new ApiError(400, 'Noma’lum AI so‘rovi');
    const ent = await this.billing.entitlementOf(uid);
    if (!ent.ai) throw new ApiError(402, 'AI yordamchi «AI» tarifida mavjud', { upgrade: true });
    if (ent.aiUsed + cost > ent.aiQuota) throw new ApiError(429, `Bu oylik AI limiti tugadi (${ent.aiQuota})`, { upgrade: true });
    const { p } = await this.projects.access(Number(b.projectId), uid, kind === 'plan' ? 'editor' : 'viewer');

    const t = this.task(kind, b, p.name);
    const key = createHash('sha1').update(`${kind}\n${t.prompt}`).digest('base64url');
    if (!b.fresh) {
      const hit = this.cache.get(key);
      if (hit) {
        void this.record(kind, { ok: 1, cached: 1 });
        return { ...hit, cached: true, used: ent.aiUsed, quota: ent.aiQuota };
      }
    }
    if (this.busy.has(uid)) throw new ApiError(429, 'Oldingi so‘rov hali tugamadi');
    this.busy.add(uid);
    await this.slot();
    try {
      const r = await this.gemini(t.prompt, t.schema);
      const result = t.parse(r.text);
      void this.record(kind, { ok: 1, tin: r.tin, tout: r.tout });
      const [row] = await this.prisma.$queryRaw<{ aiUsed: number }[]>`
        UPDATE "User" SET "aiUsed" = CASE WHEN "aiMonth" = ${monthKey()} THEN "aiUsed" + ${cost} ELSE ${cost} END, "aiMonth" = ${monthKey()}
        WHERE id = ${BigInt(uid)} RETURNING "aiUsed"`;
      this.cache.set(key, result, JSON.stringify(result).length * 2 + 100);
      return { ...result, used: row?.aiUsed ?? ent.aiUsed + cost, quota: ent.aiQuota };
    } catch (e) {
      void this.record(kind, {});
      if (e instanceof ApiError) throw e;
      this.logger.warn(`${kind} failed: ${(e as Error).message}`);
      throw new ApiError(502, 'AI javob bermadi, qayta urinib ko‘ring');
    } finally {
      this.busy.delete(uid);
      this.release();
    }
  }
}
