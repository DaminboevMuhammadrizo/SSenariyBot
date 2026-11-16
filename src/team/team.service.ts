// Team workspace: members and their activity, tasks with deadlines (assign → done → approve / reject).
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TgService, esc, appKeyboard } from '../tg/tg.service';
import { BillingService, MyTeam } from '../billing/billing.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ApiError } from '../common/errors';
import { conf } from '../common/config';
import { DAY, dayKey, fmtDate, fmtTime, ms } from '../common/time';
import { str } from '../common/constants';

const isBoss = (t: MyTeam) => t.role === 'owner' || t.role === 'manager';
const kb = () => appKeyboard('Vazifani ochish', 'v=team');

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService, private tg: TgService, private billing: BillingService, private scheduler: SchedulerService) {}

  async myTeam(uid: number, boss = false) {
    const t = await this.billing.teamOf(uid);
    if (!t) throw new ApiError(404, 'Siz jamoada emassiz');
    if (boss && !isBoss(t)) throw new ApiError(403, 'Faqat rahbar yoki menejer');
    return t;
  }
  private touch(id: number) {
    return this.prisma.team.update({ where: { id }, data: { rev: { increment: 1 } } });
  }
  private async nameOf(uid: number | bigint) {
    return (await this.prisma.user.findUnique({ where: { id: uid }, select: { name: true } }))?.name || 'Xodim';
  }
  private inviteLink(tok: string | null) {
    const bot = conf().botUsername;
    return tok && bot ? `https://t.me/${bot}?startapp=t_${tok}` : null;
  }

  /** Everything the team screen shows: members with activity and task stats, tasks, team projects. */
  async overview(uid: number) {
    const t = await this.myTeam(uid);
    const now = Date.now();
    const days = Array.from({ length: 14 }, (_, i) => dayKey(now - (13 - i) * DAY));
    const d30 = dayKey(now - 29 * DAY);
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: t.id },
      orderBy: { joinedAt: 'asc' },
      include: { user: { select: { name: true, username: true, lastSeen: true } } },
    });
    const ids = members.map((m) => m.userId);
    const [activity, taskStats, tasks, projects] = await Promise.all([
      this.prisma.activity.findMany({ where: { userId: { in: ids }, day: { gte: d30 } } }),
      this.prisma.$queryRaw<any[]>`
        SELECT "assigneeId",
               COUNT(*) FILTER (WHERE status = 'open')::int AS open,
               COUNT(*) FILTER (WHERE status = 'done')::int AS done,
               COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
               COUNT(*) FILTER (WHERE status = 'open' AND deadline < NOW() AT TIME ZONE 'UTC')::int AS overdue,
               COUNT(*) FILTER (WHERE status IN ('done','approved') AND "doneAt" <= deadline)::int AS ontime,
               COUNT(*) FILTER (WHERE status IN ('done','approved'))::int AS finished
        FROM "Task" WHERE "teamId" = ${t.id} GROUP BY "assigneeId"`,
      this.prisma.task.findMany({
        where: { teamId: t.id, OR: [{ status: { not: 'approved' } }, { approvedAt: { gt: new Date(now - 30 * DAY) } }] },
        orderBy: [{ deadline: 'asc' }],
        take: 300,
      }),
      this.prisma.project.findMany({ where: { teamId: t.id, archived: false }, select: { id: true, name: true } }),
    ]);
    const act = new Map<number, { a7: number; a30: number; days30: number; days: Record<string, number> }>();
    for (const r of activity) {
      const k = Number(r.userId);
      let a = act.get(k);
      if (!a) act.set(k, (a = { a7: 0, a30: 0, days30: 0, days: {} }));
      a.a30 += r.n;
      a.days30++;
      if (r.day >= days[7]) a.a7 += r.n;
      a.days[r.day] = r.n;
    }
    const ts = new Map(taskStats.map((r) => [Number(r.assigneeId), r]));
    return {
      team: { id: t.id, name: t.name, seats: t.seats, until: ms(t.paidUntil), active: ms(t.paidUntil) > now, role: t.role, owner: Number(t.ownerId), invite: isBoss(t) ? this.inviteLink(t.inviteToken) : null },
      days,
      members: members
        .sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'))
        .map((m) => {
          const id = Number(m.userId);
          const a = act.get(id);
          const s = ts.get(id);
          return {
            id,
            role: m.role,
            name: m.user.name,
            username: m.user.username,
            joinedAt: ms(m.joinedAt),
            lastSeen: ms(m.user.lastSeen),
            a7: a?.a7 || 0,
            a30: a?.a30 || 0,
            days30: a?.days30 || 0,
            spark: days.map((d) => a?.days[d] || 0),
            tasks: { open: s?.open || 0, done: s?.done || 0, approved: s?.approved || 0, overdue: s?.overdue || 0, ontime: s?.ontime || 0, finished: s?.finished || 0 },
          };
        }),
      tasks: tasks
        .sort((a, b) => Number(a.status === 'approved') - Number(b.status === 'approved'))
        .map((x) => ({
          id: x.id,
          projectId: x.projectId,
          title: x.title,
          descr: x.descr,
          assignee: Number(x.assigneeId),
          createdBy: Number(x.createdBy),
          deadline: ms(x.deadline),
          status: x.status,
          note: x.note,
          doneAt: ms(x.doneAt),
          approvedAt: ms(x.approvedAt),
          createdAt: ms(x.createdAt),
        })),
      projects,
    };
  }

  async rename(uid: number, name: string) {
    const t = await this.myTeam(uid, true);
    if (str(name, 60)) await this.prisma.team.update({ where: { id: t.id }, data: { name: str(name, 60), rev: { increment: 1 } } });
    return { ok: true };
  }

  async invite(uid: number, reset: boolean) {
    const t = await this.myTeam(uid, true);
    let tok = t.inviteToken;
    if (!tok || reset) {
      tok = randomBytes(9).toString('base64url');
      await this.prisma.team.update({ where: { id: t.id }, data: { inviteToken: tok, rev: { increment: 1 } } });
    }
    return { link: this.inviteLink(tok), code: `t_${tok}` };
  }

  async joinTeam(uid: number, tok: string) {
    const t = await this.prisma.team.findUnique({ where: { inviteToken: tok } });
    if (!t) throw new ApiError(404, 'Taklif havolasi eskirgan');
    const cur = await this.billing.teamOf(uid);
    if (cur?.id === t.id) return t.id;
    if (cur) throw new ApiError(409, `Siz allaqachon «${cur.name}» jamoasidasiz`);
    if (ms(t.paidUntil) < Date.now()) throw new ApiError(402, 'Jamoa obunasi tugagan');
    const n = await this.prisma.teamMember.count({ where: { teamId: t.id } });
    if (n >= t.seats) throw new ApiError(409, `Jamoada joy qolmagan (${t.seats} kishi)`);
    await this.prisma.teamMember.create({ data: { teamId: t.id, userId: uid, role: 'member' } });
    await this.touch(t.id);
    void this.tg.send(t.ownerId, `👋 <b>${esc(await this.nameOf(uid))}</b> «${esc(t.name)}» jamoasiga qo‘shildi (${n + 1}/${t.seats}).`, kb());
    return t.id;
  }

  async setRole(uid: number, member: number, role: string) {
    const t = await this.myTeam(uid);
    if (t.role !== 'owner') throw new ApiError(403, 'Faqat jamoa egasi');
    if (member === uid) throw new ApiError(400, 'O‘zingizni o‘zgartira olmaysiz');
    await this.prisma.teamMember.updateMany({ where: { teamId: t.id, userId: member, role: { not: 'owner' } }, data: { role: role === 'manager' ? 'manager' : 'member' } });
    await this.touch(t.id);
    return { ok: true };
  }

  async removeMember(uid: number, member: number) {
    const t = await this.myTeam(uid);
    const self = member === uid;
    if (self && t.role === 'owner') throw new ApiError(400, 'Jamoa egasi chiqib keta olmaydi');
    if (!self && t.role !== 'owner') throw new ApiError(403, 'Faqat jamoa egasi');
    await this.prisma.teamMember.deleteMany({ where: { teamId: t.id, userId: member, role: { not: 'owner' } } });
    await this.touch(t.id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- tasks
  private async taskFields(b: any, t: MyTeam, partial: boolean) {
    const f: any = {};
    if (!partial || b.title !== undefined) {
      f.title = str(b.title, 200);
      if (!f.title) throw new ApiError(400, 'Vazifa nomini kiriting');
    }
    if (!partial || b.descr !== undefined) f.descr = str(b.descr, 3000);
    if (!partial || b.deadline !== undefined) {
      const d = Number(b.deadline);
      if (!(d > Date.now() - DAY && d < Date.now() + 730 * DAY)) throw new ApiError(400, 'Muddat noto‘g‘ri');
      f.deadline = new Date(d);
      f.reminded = 0;
    }
    if (!partial || b.assignee !== undefined) {
      const ok = await this.prisma.teamMember.findFirst({ where: { teamId: t.id, userId: Number(b.assignee) } });
      if (!ok) throw new ApiError(400, 'Xodim jamoada emas');
      f.assigneeId = Number(b.assignee);
    }
    if (!partial || b.projectId !== undefined) {
      const p = b.projectId ? await this.prisma.project.findFirst({ where: { id: Number(b.projectId), teamId: t.id } }) : null;
      f.projectId = p ? p.id : null;
    }
    return f;
  }
  private msg(task: { title: string; descr?: string; deadline: Date }, head: string) {
    return `${head}\n\n<b>${esc(task.title)}</b>${task.descr ? `\n${esc(task.descr.slice(0, 500))}` : ''}\n\n⏳ Muddat: <b>${fmtDate(task.deadline)} ${fmtTime(task.deadline)}</b>`;
  }

  async createTask(uid: number, b: any) {
    const t = await this.myTeam(uid, true);
    if (ms(t.paidUntil) < Date.now()) throw new ApiError(402, 'Jamoa obunasi tugagan');
    const f = await this.taskFields(b, t, false);
    const task = await this.prisma.task.create({ data: { ...f, teamId: t.id, createdBy: uid } });
    await this.touch(t.id);
    this.scheduler.rearm();
    if (f.assigneeId !== uid) void this.tg.send(f.assigneeId, this.msg(task, `📌 <b>Yangi vazifa</b> · ${esc(await this.nameOf(uid))}`), kb());
    return { id: task.id };
  }

  async updateTask(uid: number, id: number, b: any) {
    const t = await this.myTeam(uid);
    const task = await this.prisma.task.findFirst({ where: { id, teamId: t.id } });
    if (!task) throw new ApiError(404, 'Vazifa topilmadi');
    const boss = isBoss(t);
    const now = new Date();
    const note = str(b.note, 1000);
    const assignee = Number(task.assigneeId);

    if (b.action === 'done') {
      if (assignee !== uid && !boss) throw new ApiError(403, 'Bu vazifa sizga berilmagan');
      if (task.status !== 'open') throw new ApiError(409, 'Vazifa ochiq emas');
      await this.prisma.task.update({ where: { id }, data: { status: 'done', doneAt: now, note } });
      if (Number(task.createdBy) !== uid)
        void this.tg.send(task.createdBy, this.msg(task, `✅ <b>${esc(await this.nameOf(uid))}</b> vazifani bajardi — tasdiqlang${note ? `\n💬 ${esc(note)}` : ''}${+now > +task.deadline ? '\n⚠️ Muddatdan kech' : ''}`), kb());
    } else if (b.action === 'approve' || b.action === 'reject') {
      if (!boss) throw new ApiError(403, 'Faqat rahbar tasdiqlaydi');
      if (task.status !== 'done') throw new ApiError(409, 'Vazifa hali bajarilmagan');
      if (b.action === 'approve') {
        await this.prisma.task.update({ where: { id }, data: { status: 'approved', approvedAt: now } });
        void this.tg.send(assignee, this.msg(task, '🏁 <b>Vazifa tasdiqlandi</b>'), kb());
      } else {
        await this.prisma.task.update({ where: { id }, data: { status: 'open', doneAt: null, note, reminded: 0 } });
        void this.tg.send(assignee, this.msg(task, `↩️ <b>Vazifa qaytarildi</b>${note ? `\n💬 ${esc(note)}` : ''}`), kb());
        this.scheduler.rearm();
      }
    } else if (b.action === 'reopen') {
      if (!boss) throw new ApiError(403, 'Faqat rahbar');
      await this.prisma.task.update({ where: { id }, data: { status: 'open', doneAt: null, approvedAt: null, reminded: 0 } });
      this.scheduler.rearm();
    } else {
      if (!boss) throw new ApiError(403, 'Faqat rahbar tahrirlaydi');
      const f = await this.taskFields(b, t, true);
      await this.prisma.task.update({ where: { id }, data: f });
      if (f.assigneeId && f.assigneeId !== assignee) void this.tg.send(f.assigneeId, this.msg({ ...task, ...f }, '📌 <b>Sizga vazifa berildi</b>'), kb());
      if ('deadline' in f) this.scheduler.rearm();
    }
    await this.touch(t.id);
    return { ok: true };
  }

  async deleteTask(uid: number, id: number) {
    const t = await this.myTeam(uid, true);
    await this.prisma.task.deleteMany({ where: { id, teamId: t.id } });
    await this.touch(t.id);
    return { ok: true };
  }
}
