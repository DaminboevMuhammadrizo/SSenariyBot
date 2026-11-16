// Reminders without polling: one timer is armed for the next due moment (post reminder or task
// deadline), found with an indexed MIN() query. Every change to a reminder re-arms it.
// An hourly sweep sends subscription-expiry notices and the daily database copy.
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { spawn } from 'child_process';
import { createGzip } from 'zlib';
import { PrismaService } from '../prisma/prisma.service';
import { TgService, esc, appKeyboard } from '../tg/tg.service';
import { BillingService } from '../billing/billing.service';
import { conf } from '../common/config';
import { DAY, dayKey, fmtDate, fmtTime } from '../common/time';
import { PLATFORM_NAME } from '../common/constants';

const LEAD = 3 * 3_600_000; // task reminder: 3 hours before the deadline
const MAX_SLEEP = 5 * 60_000; // re-check at least every 5 minutes anyway

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Scheduler');
  private timer?: NodeJS.Timeout;
  private soon?: NodeJS.Timeout;
  private hourly?: NodeJS.Timeout;
  private lastBackupDay = '';

  constructor(private prisma: PrismaService, private tg: TgService, private billing: BillingService) {}

  onApplicationBootstrap() {
    void this.arm();
    setTimeout(() => void this.sweep(), 30_000).unref();
    this.hourly = setInterval(() => void this.sweep(), 3_600_000).unref();
  }
  onModuleDestroy() {
    clearTimeout(this.timer);
    clearTimeout(this.soon);
    clearInterval(this.hourly);
  }

  /** Call after a reminder or deadline changed. Debounced: a burst of edits computes once. */
  rearm() {
    if (this.soon) return;
    this.soon = setTimeout(() => {
      this.soon = undefined;
      void this.arm();
    }, 300);
  }

  private async arm() {
    clearTimeout(this.timer);
    let next = Infinity;
    try {
      const [a] = await this.prisma.$queryRaw<{ t: Date | null }[]>`SELECT MIN("remindAt") AS t FROM "Post" WHERE reminded = false AND "remindAt" IS NOT NULL`;
      const [b] = await this.prisma.$queryRaw<{ t: Date | null }[]>`
        SELECT MIN(CASE WHEN reminded = 0 THEN deadline - make_interval(secs => ${LEAD / 1000}) ELSE deadline END) AS t
        FROM "Task" WHERE status = 'open' AND reminded < 2`;
      next = Math.min(a?.t ? +a.t : Infinity, b?.t ? +b.t : Infinity);
    } catch (e) {
      this.logger.error(`arm: ${(e as Error).message}`);
    }
    const delay = Math.max(0, Math.min(next - Date.now(), MAX_SLEEP));
    this.timer = setTimeout(async () => {
      try {
        await this.runDue();
      } catch (e) {
        this.logger.error(`run: ${(e as Error).message}`);
      }
      void this.arm();
    }, delay);
    this.timer.unref?.();
  }

  private async runDue() {
    const now = new Date();
    // ---- posts
    const posts = await this.prisma.post.findMany({
      where: { reminded: false, remindAt: { lte: now } },
      take: 500,
      select: { id: true, title: true, date: true, time: true, platform: true, kind: true, status: true, authorId: true, projectId: true, project: { select: { name: true, ownerId: true } } },
    });
    if (posts.length) await this.prisma.post.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { reminded: true } });
    for (const p of posts) {
      if (p.status === 'published') continue;
      const when = `${p.date.split('-').reverse().join('.')}${p.time ? ` ${p.time}` : ''}`;
      const text = `🔔 <b>${esc(p.title)}</b>\n${PLATFORM_NAME[p.platform] || p.platform} · ${p.kind} · ${when}\n\nLoyiha: ${esc(p.project.name)}`;
      for (const uid of new Set([Number(p.authorId), Number(p.project.ownerId)])) void this.tg.send(uid, text, appKeyboard('Postni ochish', `p=${p.projectId}&post=${p.id}`));
    }
    // ---- task deadlines: one reminder before, one when overdue (to the assignee and to the boss)
    const tasks = await this.prisma.$queryRaw<{ id: number; title: string; deadline: Date; reminded: number; assigneeId: bigint; createdBy: bigint }[]>`
      SELECT id, title, deadline, reminded, "assigneeId", "createdBy" FROM "Task"
      WHERE status = 'open' AND reminded < 2
        AND (CASE WHEN reminded = 0 THEN deadline - make_interval(secs => ${LEAD / 1000}) ELSE deadline END) <= ${now}::timestamp
      LIMIT 500`;
    const kb = appKeyboard('Vazifani ochish', 'v=team');
    for (const t of tasks) {
      const overdue = +t.deadline <= +now;
      await this.prisma.task.update({ where: { id: t.id }, data: { reminded: overdue ? 2 : 1 } });
      if (overdue) {
        void this.tg.send(t.assigneeId, `⚠️ <b>Muddat o‘tdi</b>\n${esc(t.title)}`, kb);
        if (t.createdBy !== t.assigneeId) {
          const who = (await this.prisma.user.findUnique({ where: { id: t.assigneeId }, select: { name: true } }))?.name || 'Xodim';
          void this.tg.send(t.createdBy, `⚠️ <b>${esc(who)}</b> vazifani muddatida bajarmadi\n${esc(t.title)}`, kb);
        }
      } else void this.tg.send(t.assigneeId, `⏰ <b>Muddat yaqin: ${fmtDate(t.deadline)} ${fmtTime(t.deadline)}</b>\n${esc(t.title)}`, kb);
    }
  }

  // ---------------------------------------------------------------- hourly sweep
  private async sweep() {
    try {
      const now = new Date();
      const soon = new Date(Date.now() + 3 * DAY);
      const users = await this.prisma.user.findMany({ where: { planUntil: { gt: now, lte: soon } }, select: { id: true, plan: true, planUntil: true, expNote: true } });
      for (const u of users) {
        if (u.expNote && +u.expNote === +u.planUntil!) continue;
        await this.prisma.user.update({ where: { id: u.id }, data: { expNote: u.planUntil } });
        void this.tg.send(u.id, `⏳ <b>${esc(this.billing.plans.get(u.plan)?.name || u.plan)}</b> obunasi ${fmtDate(u.planUntil!)} da tugaydi.`, appKeyboard('Uzaytirish', 'v=plans'));
      }
      const teams = await this.prisma.team.findMany({ where: { paidUntil: { gt: now, lte: soon } } });
      for (const t of teams) {
        if (t.expNote && +t.expNote === +t.paidUntil) continue;
        await this.prisma.team.update({ where: { id: t.id }, data: { expNote: t.paidUntil } });
        void this.tg.send(t.ownerId, `⏳ «${esc(t.name)}» jamoa obunasi ${fmtDate(t.paidUntil)} da tugaydi.`, appKeyboard('Uzaytirish', 'v=plans'));
      }
      // activity older than ~13 months is not shown anywhere
      await this.prisma.activity.deleteMany({ where: { day: { lt: dayKey(Date.now() - 400 * DAY) } } });
      void this.backup();
    } catch (e) {
      this.logger.error(`sweep: ${(e as Error).message}`);
    }
  }

  /** Once a day: pg_dump | gzip → document in the private storage channel (STORAGE_CHAT_ID). */
  async backup(force = false): Promise<string> {
    const c = conf();
    if (!c.storageChat || !this.tg.enabled) return 'STORAGE_CHAT_ID sozlanmagan';
    const day = dayKey();
    if (!force && day === this.lastBackupDay) return 'bugun allaqachon olingan';
    this.lastBackupDay = day;
    try {
      const data = await new Promise<Buffer>((resolve, reject) => {
        const dump = spawn('pg_dump', ['--no-owner', '--no-privileges', c.databaseUrl]);
        const gz = createGzip({ level: 6 });
        const parts: Buffer[] = [];
        let size = 0;
        dump.stdout.pipe(gz);
        gz.on('data', (b: Buffer) => {
          size += b.length;
          if (size > 49 * 2 ** 20) return dump.kill(), reject(new Error('backup is over 49 MB'));
          parts.push(b);
        });
        gz.on('end', () => resolve(Buffer.concat(parts)));
        dump.on('error', reject);
        dump.on('close', (code) => code && reject(new Error(`pg_dump exited with ${code}`)));
      });
      const users = await this.prisma.user.count();
      await this.tg.api.sendDocument(c.storageChat, { source: data, filename: `tartib-${day}.sql.gz` }, { caption: `🗄 Ssenariychi DB · ${users} foydalanuvchi · ${day}`, disable_notification: true });
      this.logger.log(`backup sent (${(data.length / 2 ** 20).toFixed(1)} MB)`);
      return 'nusxa kanalga yuborildi';
    } catch (e) {
      this.logger.error(`backup: ${(e as Error).message}`);
      return `xato: ${(e as Error).message}`;
    }
  }
}
