// Plans, prices, team pricing, subscriptions and payments.
// Plans and settings are tiny and read on almost every request: they live in memory and are reloaded
// only when the admin changes them.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Plan, Team, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TgService, esc, appKeyboard } from '../tg/tg.service';
import { ApiError } from '../common/errors';
import { conf } from '../common/config';
import { DAY, fmtDate, money, monthKey, ms } from '../common/time';
import { str } from '../common/constants';

export const DEFAULT_PLANS = [
  { id: 'free', name: 'Bepul', priceMonth: 0, priceYear: 0, ai: false, aiQuota: 0, maxProjects: 1, maxPosts: 30, sort: 0 },
  { id: 'pro', name: 'Pro', priceMonth: 13_000, priceYear: 100_000, ai: false, aiQuota: 0, maxProjects: 0, maxPosts: 0, sort: 1 },
  { id: 'pro_ai', name: 'Pro + AI', priceMonth: 26_000, priceYear: 134_000, ai: true, aiQuota: 300, maxProjects: 0, maxPosts: 0, sort: 2 },
];
export const DEFAULT_SETTINGS = {
  // team subscription: price per person; from `bulkFrom` people on, the bulk price per person applies
  team: { seatMonth: 13_000, seatYear: 100_000, bulkFrom: 30, bulkMonth: 10_000, bulkYear: 77_000, minSeats: 2, maxSeats: 500, ai: 1, aiQuota: 200 },
  card: { number: '', holder: '', note: '' }, // manual payment (when PAYMENT_PROVIDER_TOKEN is empty)
};
export type TeamSettings = typeof DEFAULT_SETTINGS.team;
export type CardSettings = typeof DEFAULT_SETTINGS.card;
export type MyTeam = Team & { role: string };

export const publicPlan = (p: Plan) => ({
  id: p.id,
  name: p.name,
  month: p.priceMonth,
  year: p.priceYear,
  ai: p.ai,
  aiQuota: p.aiQuota,
  maxProjects: p.maxProjects,
  maxPosts: p.maxPosts,
  active: p.active,
  sort: p.sort,
});

const addPeriod = (from: number, period: string) => {
  const d = new Date(from);
  d.setMonth(d.getMonth() + (period === 'year' ? 12 : 1));
  return d;
};

@Injectable()
export class BillingService implements OnModuleInit {
  readonly plans = new Map<string, Plan>();
  private settings = new Map<string, any>();

  constructor(private prisma: PrismaService, private tg: TgService) {}

  async onModuleInit() {
    if (!(await this.prisma.plan.count())) await this.prisma.plan.createMany({ data: DEFAULT_PLANS });
    await this.loadPlans();
    for (const r of await this.prisma.setting.findMany()) this.settings.set(r.key, { ...(DEFAULT_SETTINGS as any)[r.key], ...(r.value as object) });
  }

  async loadPlans() {
    this.plans.clear();
    for (const p of await this.prisma.plan.findMany({ orderBy: [{ sort: 'asc' }, { priceMonth: 'asc' }] })) this.plans.set(p.id, p);
  }
  publicPlans() {
    return [...this.plans.values()].filter((p) => p.active).map(publicPlan);
  }

  setting(key: 'team'): TeamSettings;
  setting(key: 'card'): CardSettings;
  setting(key: string) {
    return this.settings.get(key) || (DEFAULT_SETTINGS as any)[key];
  }
  async saveSetting(key: 'team' | 'card', value: Record<string, unknown>) {
    const merged = { ...this.setting(key as any), ...value };
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: merged }, update: { value: merged } });
    this.settings.set(key, merged);
    return merged;
  }

  // ---------------------------------------------------------------- what a user may do
  async teamOf(uid: number): Promise<MyTeam | null> {
    const m = await this.prisma.teamMember.findUnique({ where: { userId: uid }, include: { team: true } });
    return m ? { ...m.team, role: m.role } : null;
  }

  /** Effective rights: personal plan and team subscription, whichever is more generous. */
  entitlement(user: User, team: MyTeam | null) {
    const now = Date.now();
    const paid = ms(user.planUntil) > now && this.plans.has(user.plan);
    const plan = this.plans.get(paid ? user.plan : 'free') || (DEFAULT_PLANS[0] as Plan);
    const teamActive = !!team && ms(team.paidUntil) > now;
    const ts = this.setting('team');
    let { maxProjects, maxPosts } = plan;
    let ai = plan.ai;
    let aiQuota = plan.ai ? plan.aiQuota : 0;
    if (teamActive) {
      maxProjects = 0; // 0 = unlimited
      maxPosts = 0;
      if (ts.ai) {
        ai = true;
        aiQuota = Math.max(aiQuota, ts.aiQuota);
      }
    }
    return {
      plan: { id: plan.id, name: plan.name, until: paid ? ms(user.planUntil) : 0 },
      ai,
      aiQuota,
      aiUsed: user.aiMonth === monthKey() ? user.aiUsed : 0,
      maxProjects,
      maxPosts,
      team: team ? { id: team.id, name: team.name, role: team.role, seats: team.seats, until: ms(team.paidUntil), active: teamActive } : null,
    };
  }
  async entitlementOf(uid: number) {
    const [u, t] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: uid } }), this.teamOf(uid)]);
    return this.entitlement(u, t);
  }

  // ---------------------------------------------------------------- prices
  quote(b: { kind: string; planId?: string; period: string; seats?: number }) {
    if (b.period !== 'month' && b.period !== 'year') throw new ApiError(400, 'Davr noto‘g‘ri');
    const month = b.period === 'month';
    if (b.kind === 'plan') {
      const p = this.plans.get(String(b.planId));
      if (!p || !p.active || !(p.priceMonth || p.priceYear)) throw new ApiError(400, 'Tarif topilmadi');
      const amount = month ? p.priceMonth : p.priceYear;
      if (!amount) throw new ApiError(400, 'Bu davr uchun narx belgilanmagan');
      return { amount, seats: 0, title: `${p.name} · ${month ? '1 oy' : '1 yil'}` };
    }
    if (b.kind === 'team') {
      const t = this.setting('team');
      const seats = Math.floor(Number(b.seats));
      if (!(seats >= t.minSeats && seats <= t.maxSeats)) throw new ApiError(400, `Odamlar soni ${t.minSeats}–${t.maxSeats}`);
      const bulk = seats >= t.bulkFrom;
      const unit = month ? (bulk ? t.bulkMonth : t.seatMonth) : bulk ? t.bulkYear : t.seatYear;
      return { amount: unit * seats, unit, bulk, seats, title: `Jamoa · ${seats} kishi · ${month ? '1 oy' : '1 yil'}` };
    }
    throw new ApiError(400, 'Noma’lum to‘lov turi');
  }

  // ---------------------------------------------------------------- payments
  /** Creates a payment and says how to pay it: a Telegram invoice link, or card + receipt in the bot. */
  async createPayment(uid: number, b: any) {
    const kind = b.kind === 'team' ? 'team' : 'plan';
    const qt = this.quote({ kind, planId: b.planId, period: b.period, seats: b.seats });
    if (kind === 'team') {
      const t = await this.teamOf(uid);
      if (t && t.role !== 'owner') throw new ApiError(409, 'Siz boshqa jamoa a’zosisiz. Avval undan chiqing.');
    }
    const c = conf();
    const method = c.paymentToken ? 'invoice' : 'card';
    const card = this.setting('card');
    if (method === 'card' && !card.number) throw new ApiError(503, 'To‘lov hali sozlanmagan. Admin bilan bog‘laning.');
    const pay = await this.prisma.payment.create({
      data: { userId: uid, kind, planId: kind === 'plan' ? String(b.planId) : null, period: b.period, seats: qt.seats || 0, teamName: str(b.teamName, 60) || null, amount: qt.amount, method },
    });
    if (method === 'invoice') {
      const link = await this.tg.api.createInvoiceLink({
        title: `Tartib — ${qt.title}`.slice(0, 32),
        description: kind === 'team' ? 'Jamoa obunasi: vazifalar, faollik, umumiy loyihalar' : 'Shaxsiy obuna',
        payload: `pay:${pay.id}`,
        provider_token: c.paymentToken,
        currency: 'UZS',
        prices: [{ label: qt.title, amount: qt.amount * 100 }],
      });
      return { id: pay.id, method, amount: qt.amount, invoiceLink: link };
    }
    await this.prisma.user.update({ where: { id: uid }, data: { state: `receipt:${pay.id}` } });
    void this.tg.send(
      uid,
      `<b>To‘lov #${pay.id}</b> · ${esc(qt.title)}\n\nSumma: <b>${money(qt.amount)}</b>\nKarta: <code>${esc(card.number)}</code>${card.holder ? `\n${esc(card.holder)}` : ''}${card.note ? `\n\n${esc(card.note)}` : ''}\n\nTo‘lagach, <b>chek rasmini shu chatga yuboring</b>. Admin tasdiqlashi bilan obuna yoqiladi.`,
    );
    return { id: pay.id, method, amount: qt.amount, card: { number: card.number, holder: card.holder }, bot: c.botUsername };
  }

  /** Marks a payment paid and turns the subscription on (idempotent). */
  async activate(payId: number, adminId: number | null = null) {
    const res = await this.prisma.$transaction(async (db) => {
      // only one caller can move it out of new/pending: a double tap does nothing the second time
      const moved = await db.payment.updateMany({ where: { id: payId, status: { in: ['new', 'pending'] } }, data: { status: 'paid', decidedAt: new Date(), decidedBy: adminId } });
      if (!moved.count) return null;
      const p = await db.payment.findUniqueOrThrow({ where: { id: payId } });
      const now = Date.now();
      if (p.kind === 'plan') {
        const u = await db.user.findUniqueOrThrow({ where: { id: p.userId } });
        const from = u.plan === p.planId && ms(u.planUntil) > now ? ms(u.planUntil) : now;
        const until = addPeriod(from, p.period);
        await db.user.update({ where: { id: p.userId }, data: { plan: p.planId!, planUntil: until, expNote: null, state: null } });
        return { p, until, title: this.plans.get(p.planId!)?.name || p.planId! };
      }
      const own = await db.team.findFirst({ where: { ownerId: p.userId } });
      await db.user.update({ where: { id: p.userId }, data: { state: null } });
      if (own) {
        const until = addPeriod(Math.max(now, ms(own.paidUntil)), p.period);
        await db.team.update({ where: { id: own.id }, data: { seats: p.seats, paidUntil: until, expNote: null, rev: { increment: 1 }, ...(p.teamName ? { name: p.teamName } : {}) } });
        return { p, until, title: `Jamoa · ${p.seats} kishi` };
      }
      await db.teamMember.deleteMany({ where: { userId: p.userId } }); // a member who buys their own team moves into it
      const until = addPeriod(now, p.period);
      await db.team.create({
        data: {
          ownerId: p.userId,
          name: p.teamName || 'Mening jamoam',
          seats: p.seats,
          paidUntil: until,
          inviteToken: randomBytes(9).toString('base64url'),
          members: { create: { userId: p.userId, role: 'owner' } },
        },
      });
      return { p, until, title: `Jamoa · ${p.seats} kishi` };
    });
    if (res) void this.tg.send(res.p.userId, `✅ <b>To‘lov tasdiqlandi</b>\n${esc(res.title)} — <b>${fmtDate(res.until)}</b> gacha faol.`, appKeyboard('Ilovani ochish'));
    return res;
  }

  async reject(payId: number, adminId: number | null = null) {
    const moved = await this.prisma.payment.updateMany({ where: { id: payId, status: { in: ['new', 'pending'] } }, data: { status: 'rejected', decidedAt: new Date(), decidedBy: adminId } });
    if (!moved.count) return null;
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: payId } });
    await this.prisma.user.updateMany({ where: { id: p.userId, state: `receipt:${payId}` }, data: { state: null } });
    void this.tg.send(p.userId, `❌ To‘lov #${payId} tasdiqlanmadi. Savol bo‘lsa, shu chatga yozing.`);
    return p;
  }

  /** Admin grants a plan by hand (gift, compensation). */
  async grant(uid: number, planId: string, days: number) {
    if (!this.plans.has(planId)) throw new ApiError(400, 'Tarif topilmadi');
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u) throw new ApiError(404, 'Foydalanuvchi topilmadi');
    const now = Date.now();
    const until = planId === 'free' ? null : new Date((u.plan === planId && ms(u.planUntil) > now ? ms(u.planUntil) : now) + days * DAY);
    await this.prisma.user.update({ where: { id: uid }, data: { plan: planId, planUntil: until, expNote: null } });
    if (until) void this.tg.send(uid, `🎁 Sizga <b>${esc(this.plans.get(planId)!.name)}</b> tarifi berildi — ${fmtDate(until)} gacha.`);
    return { plan: planId, until: ms(until) };
  }
}
