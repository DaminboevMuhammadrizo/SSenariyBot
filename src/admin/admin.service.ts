// Admin: statistics in numbers and percentages, plan prices, team pricing, payment card,
// payments to approve, users and manual grants, broadcast.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService, DEFAULT_SETTINGS, publicPlan } from '../billing/billing.service';
import { ProjectsService } from '../projects/projects.service';
import { TgService, esc } from '../tg/tg.service';
import { ApiError } from '../common/errors';
import { conf } from '../common/config';
import { DAY, dayKey, dayStart, monthKey, ms } from '../common/time';
import { int, str } from '../common/constants';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const N = (x: unknown) => Number(x || 0);

@Injectable()
export class AdminService {
  private statsCache: { at: number; body: any } | null = null;

  constructor(private prisma: PrismaService, private billing: BillingService, private projects: ProjectsService, private tg: TgService) {}

  invalidate() {
    this.statsCache = null;
  }

  /** Whole dashboard in one object; recomputed at most every 10 s however many admins look. */
  async stats() {
    if (this.statsCache && Date.now() - this.statsCache.at < 10_000) return this.statsCache.body;
    const db = this.prisma;
    const now = Date.now();
    const nowD = new Date(now);
    const today = dayKey(now);
    const d7 = dayKey(now - 6 * DAY);
    const d30 = dayKey(now - 29 * DAY);
    const month = monthKey(now);
    const monthStart = dayStart(`${month}-01`);
    const q1 = async <T = any>(p: Promise<T[]>) => (await p)[0] as T;

    // ---- users
    const [total, blocked, newToday, new7, new30, dau, wau, mau] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { blocked: true } }),
      db.user.count({ where: { joinedAt: { gte: dayStart(today) } } }),
      db.user.count({ where: { joinedAt: { gte: new Date(now - 7 * DAY) } } }),
      db.user.count({ where: { joinedAt: { gte: new Date(now - 30 * DAY) } } }),
      db.activity.count({ where: { day: today } }),
      q1(db.$queryRaw<any[]>`SELECT COUNT(DISTINCT "userId")::int AS n FROM "Activity" WHERE day >= ${d7}`).then((r) => N(r.n)),
      q1(db.$queryRaw<any[]>`SELECT COUNT(DISTINCT "userId")::int AS n FROM "Activity" WHERE day >= ${d30}`).then((r) => N(r.n)),
    ]);
    const users = { total, blocked, newToday, new7, new30, dau, wau, mau, dauPct: pct(dau, total), wauPct: pct(wau, total), mauPct: pct(mau, total), stickiness: pct(dau, mau) };

    // ---- subscriptions
    const byPlan = await db.user.groupBy({ by: ['plan'], where: { planUntil: { gt: nowD } }, _count: true });
    const paidOf = (id: string) => byPlan.find((r) => r.plan === id)?._count || 0;
    const paid = byPlan.reduce((s, r) => s + r._count, 0);
    const [teamAgg, teamMembers] = await Promise.all([
      db.team.aggregate({ where: { paidUntil: { gt: nowD } }, _count: true, _sum: { seats: true } }),
      db.teamMember.count({ where: { team: { paidUntil: { gt: nowD } } } }),
    ]);
    const subs = {
      paid,
      paidPct: pct(paid, total),
      free: total - paid,
      freePct: pct(total - paid, total),
      plans: [...this.billing.plans.values()].map((p) => {
        const n = p.id === 'free' ? total - paid : paidOf(p.id);
        return { id: p.id, name: p.name, n, pct: pct(n, total) };
      }),
      teams: teamAgg._count,
      seats: teamAgg._sum.seats || 0,
      teamMembers,
      seatFill: pct(teamMembers, teamAgg._sum.seats || 0),
    };

    // ---- revenue
    const [rev, revMonth, pending, payers, byKind] = await Promise.all([
      db.payment.aggregate({ where: { status: 'paid' }, _sum: { amount: true }, _count: true }),
      db.payment.aggregate({ where: { status: 'paid', decidedAt: { gte: monthStart } }, _sum: { amount: true }, _count: true }),
      db.payment.count({ where: { status: 'pending' } }),
      q1(db.$queryRaw<any[]>`SELECT COUNT(DISTINCT "userId")::int AS n FROM "Payment" WHERE status = 'paid'`).then((r) => N(r.n)),
      db.$queryRaw<any[]>`
        SELECT kind, COALESCE("planId", 'team') AS plan, period, COUNT(*)::int AS n, SUM(amount)::int AS sum
        FROM "Payment" WHERE status = 'paid' AND "decidedAt" >= ${monthStart}::timestamp GROUP BY kind, plan, period ORDER BY sum DESC`,
    ]);
    const revenue = {
      total: rev._sum.amount || 0,
      count: rev._count,
      month: revMonth._sum.amount || 0,
      monthCount: revMonth._count,
      avg: rev._count ? Math.round((rev._sum.amount || 0) / rev._count) : 0,
      pending,
      byKind: byKind.map((k) => ({ ...k, plan: k.kind === 'team' ? 'Jamoa' : this.billing.plans.get(k.plan)?.name || k.plan })),
      conversion: pct(payers, total),
    };

    // ---- AI
    const [ai, aiAll, aiUsers, aiKinds] = await Promise.all([
      db.aiDaily.aggregate({ where: { day: { gte: `${month}-01` } }, _sum: { req: true, ok: true, cached: true, tin: true, tout: true } }),
      db.aiDaily.aggregate({ _sum: { req: true, tin: true, tout: true } }),
      db.user.aggregate({ where: { aiMonth: month, aiUsed: { gt: 0 } }, _count: true, _sum: { aiUsed: true } }),
      db.aiDaily.groupBy({ by: ['kind'], where: { day: { gte: `${month}-01` } }, _sum: { req: true, ok: true, tin: true, tout: true }, orderBy: { _sum: { req: 'desc' } } }),
    ]);
    const s = ai._sum;
    let eligible = 0;
    let quota = 0;
    for (const p of this.billing.plans.values())
      if (p.ai) {
        eligible += paidOf(p.id);
        quota += paidOf(p.id) * p.aiQuota;
      }
    const ts = this.billing.setting('team');
    if (ts.ai) {
      // team members without a personal AI plan (nobody is counted twice)
      const aiPlans = [...this.billing.plans.values()].filter((p) => p.ai).map((p) => p.id);
      const teamOnly = await db.teamMember.count({
        where: { team: { paidUntil: { gt: nowD } }, NOT: { user: { planUntil: { gt: nowD }, plan: { in: aiPlans } } } },
      });
      eligible += teamOnly;
      quota += teamOnly * ts.aiQuota;
    }
    const aiStats = {
      enabled: !!conf().geminiKey,
      model: conf().geminiModel,
      requests: s.req || 0,
      success: pct(s.ok || 0, s.req || 0),
      cachedPct: pct(s.cached || 0, s.req || 0),
      tokensIn: s.tin || 0,
      tokensOut: s.tout || 0,
      allTimeRequests: aiAll._sum.req || 0,
      allTimeTokens: (aiAll._sum.tin || 0) + (aiAll._sum.tout || 0),
      users: aiUsers._count,
      eligible,
      adoption: pct(aiUsers._count, eligible),
      usersPct: pct(aiUsers._count, total),
      used: aiUsers._sum.aiUsed || 0,
      quota,
      quotaUsed: pct(aiUsers._sum.aiUsed || 0, quota),
      byKind: aiKinds.map((r) => ({ kind: r.kind, req: r._sum.req || 0, ok: r._sum.ok || 0, tokens: (r._sum.tin || 0) + (r._sum.tout || 0), pct: pct(r._sum.req || 0, s.req || 0) })),
    };

    // ---- content & work
    const [projects, activeProjects, shared, posts, posts7, byStatus, byPlatform, up, down, comments, tasks, tasksByStatus, overdue, finished] = await Promise.all([
      db.project.count(),
      db.project.count({ where: { archived: false } }),
      q1(db.$queryRaw<any[]>`SELECT COUNT(DISTINCT "projectId")::int AS n FROM "Member"`).then((r) => N(r.n)),
      db.post.count(),
      db.post.count({ where: { createdAt: { gte: new Date(now - 7 * DAY) } } }),
      db.post.groupBy({ by: ['status'], _count: true }),
      db.post.groupBy({ by: ['platform'], _count: true, orderBy: { _count: { platform: 'desc' } } }),
      db.vote.count({ where: { v: { gt: 0 } } }),
      db.vote.count({ where: { v: { lt: 0 } } }),
      db.comment.count(),
      db.task.count(),
      db.task.groupBy({ by: ['status'], _count: true }),
      db.task.count({ where: { status: 'open', deadline: { lt: nowD } } }),
      q1(db.$queryRaw<any[]>`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE "doneAt" <= deadline)::int AS ontime FROM "Task" WHERE status IN ('done','approved')`),
    ]);
    const content = {
      projects,
      activeProjects,
      sharedProjects: shared,
      posts,
      posts7,
      perUser: total ? Math.round((posts / total) * 10) / 10 : 0,
      byStatus: byStatus.map((r) => ({ status: r.status, n: r._count, pct: pct(r._count, posts) })),
      byPlatform: byPlatform.map((r) => ({ platform: r.platform, n: r._count, pct: pct(r._count, posts) })),
      up,
      down,
      approval: pct(up, up + down),
      comments,
      tasks,
      tasksByStatus: tasksByStatus.map((r) => ({ status: r.status, n: r._count, pct: pct(r._count, tasks) })),
      overdue,
      onTime: pct(N(finished.ontime), N(finished.n)),
    };

    // ---- 14-day series
    const days = Array.from({ length: 14 }, (_, i) => dayKey(now - (13 - i) * DAY));
    const [act, aiDay, joinedRows] = await Promise.all([
      db.$queryRaw<any[]>`SELECT day, COUNT(*)::int AS dau, SUM(n)::int AS actions FROM "Activity" WHERE day >= ${days[0]} GROUP BY day`,
      db.aiDaily.groupBy({ by: ['day'], where: { day: { gte: days[0] } }, _sum: { req: true } }),
      db.user.findMany({ where: { joinedAt: { gte: new Date(now - 15 * DAY) } }, select: { joinedAt: true } }),
    ]);
    const joined = new Map<string, number>();
    for (const r of joinedRows) joined.set(dayKey(+r.joinedAt), (joined.get(dayKey(+r.joinedAt)) || 0) + 1);
    const series = days.map((d) => {
      const a = act.find((x) => x.day === d);
      return { day: d, dau: N(a?.dau), actions: N(a?.actions), ai: aiDay.find((x) => x.day === d)?._sum.req || 0, joined: joined.get(d) || 0 };
    });

    const mu = process.memoryUsage();
    const mb = (x: number) => Math.round(x / 2 ** 20);
    const dbSize = await q1(db.$queryRaw<any[]>`SELECT pg_database_size(current_database())::bigint AS b`).catch(() => ({ b: 0 }));
    const system = {
      rssMb: mb(mu.rss),
      heapMb: mb(mu.heapUsed),
      dbMb: Math.round((N(dbSize.b) / 2 ** 20) * 10) / 10,
      cache: this.projects.cache.info(),
      uptimeH: Math.round(process.uptime() / 360) / 10,
      node: process.version,
    };

    const body = { at: now, users, subs, revenue, ai: aiStats, content, series, system };
    this.statsCache = { at: now, body };
    return body;
  }

  // ---------------------------------------------------------------- plans & settings
  plansAndSettings() {
    return {
      plans: [...this.billing.plans.values()].map(publicPlan),
      team: this.billing.setting('team'),
      card: this.billing.setting('card'),
      payment: conf().paymentToken ? 'invoice' : 'card',
    };
  }

  async savePlan(rawId: string, b: any) {
    const id = String(rawId).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
    if (!id) throw new ApiError(400, 'ID noto‘g‘ri');
    const name = str(b.name, 40);
    if (!name) throw new ApiError(400, 'Nom kiriting');
    const free = id === 'free';
    const data = {
      name,
      priceMonth: free ? 0 : int(b.month),
      priceYear: free ? 0 : int(b.year),
      ai: !!b.ai,
      aiQuota: int(b.aiQuota),
      maxProjects: int(b.maxProjects),
      maxPosts: int(b.maxPosts),
      active: free || b.active !== false,
      sort: int(b.sort, this.billing.plans.size),
    };
    await this.prisma.plan.upsert({ where: { id }, create: { id, ...data }, update: data });
    await this.billing.loadPlans();
    this.invalidate();
    return { plans: [...this.billing.plans.values()].map(publicPlan) };
  }

  async deletePlan(id: string) {
    if (id === 'free') throw new ApiError(400, 'Bepul tarifni o‘chirib bo‘lmaydi');
    const users = await this.prisma.user.count({ where: { plan: id, planUntil: { gt: new Date() } } });
    // kept for current subscribers (hidden from sale), deleted when nobody uses it
    if (users) await this.prisma.plan.update({ where: { id }, data: { active: false } });
    else await this.prisma.plan.deleteMany({ where: { id } });
    await this.billing.loadPlans();
    return { plans: [...this.billing.plans.values()].map(publicPlan), hidden: !!users };
  }

  async saveSettings(b: any) {
    const out: any = {};
    if (b.team) {
      const d = DEFAULT_SETTINGS.team as Record<string, number>;
      const v: Record<string, number> = {};
      for (const k of Object.keys(d)) if (b.team[k] !== undefined) v[k] = k === 'ai' ? (b.team[k] ? 1 : 0) : int(b.team[k], d[k]);
      if (v.minSeats !== undefined) v.minSeats = Math.max(1, v.minSeats);
      out.team = await this.billing.saveSetting('team', v);
    }
    if (b.card) {
      const c = b.card;
      const v: Record<string, string> = {};
      if (typeof c.number === 'string') v.number = str(c.number, 40);
      if (typeof c.holder === 'string') v.holder = str(c.holder, 60);
      if (typeof c.note === 'string') v.note = str(c.note, 300);
      out.card = await this.billing.saveSetting('card', v);
    }
    return out;
  }

  // ---------------------------------------------------------------- payments
  async payments(status: string) {
    const where = status === 'all' ? { status: { not: 'new' } } : { status };
    const rows = await this.prisma.payment.findMany({ where, orderBy: { id: 'desc' }, take: 100, include: { user: { select: { name: true, username: true } } } });
    return {
      payments: rows.map((p) => ({
        id: p.id,
        uid: Number(p.userId),
        name: p.user.name,
        username: p.user.username,
        kind: p.kind,
        planId: p.planId,
        planName: p.planId ? this.billing.plans.get(p.planId)?.name || p.planId : null,
        period: p.period,
        seats: p.seats,
        teamName: p.teamName,
        amount: p.amount,
        status: p.status,
        method: p.method,
        at: ms(p.createdAt),
        decidedAt: ms(p.decidedAt),
        receipt: !!p.fileId,
      })),
    };
  }

  async decide(adminId: number, id: number, action: string) {
    const r = action === 'approve' ? await this.billing.activate(id, adminId) : await this.billing.reject(id, adminId);
    if (!r) throw new ApiError(409, 'To‘lov allaqachon ko‘rib chiqilgan');
    this.invalidate();
    return { ok: true };
  }

  // ---------------------------------------------------------------- users
  async users(q: string, filter: string, offset: number) {
    q = str(q, 60);
    const now = new Date();
    const where: any = {};
    if (q) {
      if (/^\d+$/.test(q)) where.id = BigInt(q);
      else where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { username: { contains: q.replace(/^@/, ''), mode: 'insensitive' } }];
    }
    if (filter === 'paid') where.planUntil = { gt: now };
    if (filter === 'ai') Object.assign(where, { aiMonth: monthKey(), aiUsed: { gt: 0 } });
    const rows = await this.prisma.user.findMany({ where, orderBy: { joinedAt: 'desc' }, skip: offset, take: 50, include: { _count: { select: { projects: true } } } });
    const month = monthKey();
    return {
      users: rows.map((u) => ({
        id: Number(u.id),
        name: u.name,
        username: u.username,
        joinedAt: ms(u.joinedAt),
        lastSeen: ms(u.lastSeen),
        blocked: u.blocked,
        plan: ms(u.planUntil) > +now ? u.plan : 'free',
        until: ms(u.planUntil),
        aiUsed: u.aiMonth === month ? u.aiUsed : 0,
        projects: u._count.projects,
      })),
      next: rows.length === 50 ? offset + 50 : null,
    };
  }

  async grant(uid: number, planId: string, days: number) {
    this.invalidate();
    return this.billing.grant(uid, String(planId || ''), Math.min(3650, int(days, 30) || 30));
  }

  async broadcast(text: string) {
    text = str(text, 3500);
    if (!text) throw new ApiError(400, 'Matn bo‘sh');
    const ids = await this.prisma.user.findMany({ where: { blocked: false }, select: { id: true } });
    for (const { id } of ids) void this.tg.send(id, esc(text));
    return { queued: ids.length };
  }
}
