// Projects, posts (content plan), reviews (good / bad) and comments, sharing by link.
// A project's full payload is the same bytes for every member, so it is built once per version
// (projects.rev), compressed, and kept in the LFU cache; members holding that version get 304.
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService, MyTeam } from '../billing/billing.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { TeamService } from '../team/team.service';
import { NotifyService } from '../tg/notify.service';
import { ByteLFU } from '../common/cache';
import { Pack, packJson, packSize } from '../common/http';
import { ApiError } from '../common/errors';
import { conf, isAdmin } from '../common/config';
import { DAY, dayKey, ms } from '../common/time';
import { KINDS, PLATFORMS, STATUSES, str } from '../common/constants';

const LEVEL: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
const token = () => randomBytes(9).toString('base64url');

@Injectable()
export class ProjectsService {
  readonly cache = new ByteLFU<Pack>(conf().cacheMb * 2 ** 20);

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private scheduler: SchedulerService,
    private team: TeamService,
    private notify: NotifyService,
  ) {}

  // ---------------------------------------------------------------- access
  /** The caller's role in a project: owner | editor | viewer. Throws 404 / 403. */
  async access(pid: number, uid: number, need: 'viewer' | 'editor' | 'owner' = 'viewer') {
    const p = await this.prisma.project.findUnique({ where: { id: pid }, select: { id: true, ownerId: true, teamId: true, name: true, rev: true } });
    if (!p) throw new ApiError(404, 'Loyiha topilmadi');
    let role: string | null = null;
    if (Number(p.ownerId) === uid) role = 'owner';
    else {
      if (p.teamId) {
        const tm = await this.prisma.teamMember.findFirst({ where: { teamId: p.teamId, userId: uid }, select: { role: true } });
        if (tm) role = tm.role === 'member' ? 'editor' : 'owner';
      }
      role ||= (await this.prisma.member.findUnique({ where: { projectId_userId: { projectId: pid, userId: uid } }, select: { role: true } }))?.role || null;
    }
    if (!role) throw new ApiError(403, 'Bu loyihaga ruxsat yo‘q');
    if (LEVEL[role] < LEVEL[need]) throw new ApiError(403, need === 'owner' ? 'Faqat loyiha egasi' : 'Faqat ko‘rish huquqi bor');
    return { p, role };
  }

  /** Every change: version +1 and the cached payload of the old version is dropped. */
  async bump(pid: number) {
    const r = await this.prisma.project.updateMany({ where: { id: pid }, data: { rev: { increment: 1 } } });
    if (!r.count) return;
    const p = await this.prisma.project.findUnique({ where: { id: pid }, select: { rev: true } });
    if (p) this.cache.delete(`p:${pid}:${p.rev - 1}`);
  }

  // ---------------------------------------------------------------- boot: everything the home screen needs
  private async projectsOf(uid: number, team: MyTeam | null) {
    const rows = await this.prisma.project.findMany({
      where: { OR: [{ ownerId: uid }, { members: { some: { userId: uid } } }, ...(team ? [{ teamId: team.id }] : [])] },
      orderBy: [{ archived: 'asc' }, { id: 'desc' }],
      select: { id: true, name: true, icon: true, color: true, ownerId: true, teamId: true, archived: true, rev: true, members: { where: { userId: uid }, select: { role: true } } },
    });
    if (!rows.length) return [];
    const counts = await this.prisma.$queryRaw<{ projectId: number; n: number; r: number; nx: string | null }[]>`
      SELECT "projectId", COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE status IN ('ready','published'))::int AS r,
             MIN(date) FILTER (WHERE date >= ${dayKey()} AND status <> 'published') AS nx
      FROM "Post" WHERE "projectId" = ANY(${rows.map((r) => r.id)}) GROUP BY "projectId"`;
    const c = new Map(counts.map((x) => [x.projectId, x]));
    return rows.map((r) => {
      const role =
        Number(r.ownerId) === uid ? 'owner' : r.teamId && team?.id === r.teamId ? (team.role === 'member' ? 'editor' : 'owner') : r.members[0]?.role || 'viewer';
      const k = c.get(r.id);
      return { id: r.id, name: r.name, icon: r.icon, color: r.color, role, team: !!r.teamId, archived: r.archived, rev: r.rev, posts: k?.n || 0, ready: k?.r || 0, next: k?.nx || null };
    });
  }

  async boot(uid: number) {
    const [u, team] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: uid } }), this.billing.teamOf(uid)]);
    const t = this.billing.setting('team');
    const c = conf();
    return {
      me: { id: uid, name: u.name, username: u.username, admin: isAdmin(uid), prefs: u.prefs },
      ent: this.billing.entitlement(u, team),
      plans: this.billing.publicPlans(),
      team: { seatMonth: t.seatMonth, seatYear: t.seatYear, bulkFrom: t.bulkFrom, bulkMonth: t.bulkMonth, bulkYear: t.bulkYear, minSeats: t.minSeats, maxSeats: t.maxSeats, ai: !!t.ai },
      pay: c.paymentToken ? 'invoice' : this.billing.setting('card').number ? 'card' : null,
      ai: !!c.geminiKey,
      bot: c.botUsername,
      projects: await this.projectsOf(uid, team),
    };
  }

  // ---------------------------------------------------------------- projects
  private projectFields(b: any) {
    const out: any = {};
    if (b.name !== undefined) {
      out.name = str(b.name, 60);
      if (!out.name) throw new ApiError(400, 'Nom kiriting');
    }
    if (b.icon !== undefined) out.icon = /^[a-z]{2,12}$/.test(b.icon) ? b.icon : 'spark';
    if (b.color !== undefined) out.color = typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color.toLowerCase() : null;
    if (b.archived !== undefined) out.archived = !!b.archived;
    return out;
  }

  async create(uid: number, b: any) {
    const [u, team] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: uid } }), this.billing.teamOf(uid)]);
    const ent = this.billing.entitlement(u, team);
    const f = this.projectFields({ icon: 'spark', color: null, ...b, name: b.name ?? '' });
    let teamId: number | null = null;
    if (b.team) {
      if (!team || ms(team.paidUntil) < Date.now()) throw new ApiError(402, 'Jamoa obunasi faol emas');
      if (team.role === 'member') throw new ApiError(403, 'Jamoa loyihasini rahbar yoki menejer ochadi');
      teamId = team.id;
    } else if (ent.maxProjects) {
      const n = await this.prisma.project.count({ where: { ownerId: uid, teamId: null, archived: false } });
      if (n >= ent.maxProjects) throw new ApiError(402, `${ent.plan.name} tarifida ${ent.maxProjects} ta loyiha. Ko‘proq uchun tarifni oshiring.`, { upgrade: true });
    }
    const p = await this.prisma.project.create({ data: { ...f, ownerId: uid, teamId } });
    if (teamId) await this.prisma.team.update({ where: { id: teamId }, data: { rev: { increment: 1 } } });
    return { id: p.id };
  }

  async update(uid: number, pid: number, b: any) {
    await this.access(pid, uid, 'owner');
    const f = this.projectFields(b);
    if (Object.keys(f).length) await this.prisma.project.update({ where: { id: pid }, data: f });
    await this.bump(pid);
    return { ok: true };
  }

  async remove(uid: number, pid: number) {
    const { p } = await this.access(pid, uid, 'owner');
    await this.prisma.project.delete({ where: { id: pid } });
    this.cache.delete(`p:${pid}:${p.rev}`);
    this.scheduler.rearm();
    return { ok: true };
  }

  /** The cached, compressed full payload of the current version. */
  async payload(pid: number, rev: number, etag: string) {
    return this.cache.getOrLoad(`p:${pid}:${rev}`, async () => {
      const pk = packJson(await this.build(pid), etag, 5);
      return { value: pk, size: packSize(pk) };
    });
  }

  private async build(pid: number) {
    const p = await this.prisma.project.findUniqueOrThrow({
      where: { id: pid },
      include: {
        owner: { select: { id: true, name: true, username: true } },
        members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: { name: true, username: true } } } },
        posts: {
          orderBy: [{ date: 'asc' }, { time: 'asc' }, { id: 'asc' }],
          include: { author: { select: { name: true } }, votes: { select: { userId: true, v: true, user: { select: { name: true } } } }, _count: { select: { comments: true } } },
        },
      },
    });
    const people: Record<number, string> = { [Number(p.owner.id)]: p.owner.name };
    for (const m of p.members) people[Number(m.userId)] = m.user.name;
    for (const x of p.posts) {
      people[Number(x.authorId)] ||= x.author.name;
      for (const v of x.votes) people[Number(v.userId)] ||= v.user.name;
    }
    return {
      id: p.id,
      rev: p.rev,
      name: p.name,
      icon: p.icon,
      color: p.color,
      archived: p.archived,
      team: p.teamId,
      owner: { id: Number(p.owner.id), name: p.owner.name, username: p.owner.username },
      members: p.members.map((m) => ({ id: Number(m.userId), role: m.role, name: m.user.name, username: m.user.username })),
      people,
      shared: !!p.shareToken,
      posts: p.posts.map((x) => ({
        id: x.id,
        date: x.date,
        time: x.time,
        platform: x.platform,
        kind: x.kind,
        status: x.status,
        title: x.title,
        body: x.body,
        notes: x.notes,
        remindAt: ms(x.remindAt) || null,
        author: Number(x.authorId),
        updatedAt: ms(x.updatedAt),
        up: x.votes.filter((v) => v.v > 0).map((v) => Number(v.userId)),
        down: x.votes.filter((v) => v.v < 0).map((v) => Number(v.userId)),
        comments: x._count.comments,
      })),
    };
  }

  async share(uid: number, pid: number, reset: boolean) {
    await this.access(pid, uid, 'owner');
    let t = (await this.prisma.project.findUniqueOrThrow({ where: { id: pid }, select: { shareToken: true } })).shareToken;
    if (!t || reset) {
      t = token();
      await this.prisma.project.update({ where: { id: pid }, data: { shareToken: t } });
      await this.bump(pid);
    }
    const bot = conf().botUsername;
    return { code: `j_${t}`, link: bot ? `https://t.me/${bot}?startapp=j_${t}` : null };
  }

  async setMemberRole(uid: number, pid: number, member: number, role: string) {
    await this.access(pid, uid, 'owner');
    await this.prisma.member.updateMany({ where: { projectId: pid, userId: member }, data: { role: role === 'editor' ? 'editor' : 'viewer' } });
    await this.bump(pid);
    return { ok: true };
  }

  async removeMember(uid: number, pid: number, member: number) {
    if (member !== uid) await this.access(pid, uid, 'owner'); // anyone may leave by themselves
    await this.prisma.member.deleteMany({ where: { projectId: pid, userId: member } });
    await this.bump(pid);
    return { ok: true };
  }

  /** { code: "j_<project token>" | "t_<team token>" } from a shared link. */
  async join(uid: number, code: string) {
    code = str(code, 80);
    if (code.startsWith('j_')) {
      const p = await this.prisma.project.findUnique({ where: { shareToken: code.slice(2) }, select: { id: true, ownerId: true, teamId: true } });
      if (!p) throw new ApiError(404, 'Havola eskirgan');
      if (Number(p.ownerId) !== uid) {
        const inTeam = p.teamId && (await this.prisma.teamMember.findFirst({ where: { teamId: p.teamId, userId: uid } }));
        if (!inTeam) {
          await this.prisma.member.upsert({ where: { projectId_userId: { projectId: p.id, userId: uid } }, create: { projectId: p.id, userId: uid, role: 'viewer' }, update: {} });
          await this.bump(p.id);
        }
      }
      return { projectId: p.id };
    }
    if (code.startsWith('t_')) return { teamId: await this.team.joinTeam(uid, code.slice(2)) };
    throw new ApiError(400, 'Noto‘g‘ri havola');
  }

  // ---------------------------------------------------------------- posts
  private postFields(b: any, partial: boolean) {
    const out: any = {};
    const has = (k: string) => b[k] !== undefined;
    if (!partial || has('title')) {
      out.title = str(b.title, 200);
      if (!out.title) throw new ApiError(400, 'Sarlavha kiriting');
    }
    if (!partial || has('date')) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw new ApiError(400, 'Sana noto‘g‘ri');
      out.date = b.date;
    }
    if (!partial || has('time')) out.time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '';
    if (!partial || has('platform')) out.platform = PLATFORMS.includes(b.platform) ? b.platform : 'instagram';
    if (!partial || has('kind')) out.kind = KINDS.includes(b.kind) ? b.kind : 'post';
    if (!partial || has('status')) out.status = STATUSES.includes(b.status) ? b.status : 'idea';
    if (!partial || has('body')) out.body = str(b.body, 8000);
    if (!partial || has('notes')) out.notes = str(b.notes, 2000);
    if (!partial || has('remindAt')) {
      const r = Number(b.remindAt);
      out.remindAt = b.remindAt && r > Date.now() - 60_000 && r < Date.now() + 730 * DAY ? new Date(r) : null;
      out.reminded = false;
    }
    return out;
  }

  /** The plan limit belongs to the project owner (a free owner's project stays limited for everyone). */
  private async checkPostLimit(pid: number, adding = 1) {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: pid }, select: { ownerId: true, teamId: true } });
    if (p.teamId) return;
    const ent = await this.billing.entitlementOf(Number(p.ownerId));
    if (!ent.maxPosts) return;
    const n = await this.prisma.post.count({ where: { projectId: pid } });
    if (n + adding > ent.maxPosts) throw new ApiError(402, `${ent.plan.name} tarifida loyihaga ${ent.maxPosts} ta post. Ko‘proq uchun tarifni oshiring.`, { upgrade: true });
  }

  async createPost(uid: number, pid: number, b: any) {
    await this.access(pid, uid, 'editor');
    await this.checkPostLimit(pid);
    const f = this.postFields(b, false);
    const post = await this.prisma.post.create({ data: { ...f, projectId: pid, authorId: uid } });
    await this.bump(pid);
    if (f.remindAt) this.scheduler.rearm();
    return { id: post.id };
  }

  /** Many posts at once (an AI plan the user accepted). */
  async createPosts(uid: number, pid: number, list: any[]) {
    await this.access(pid, uid, 'editor');
    list = Array.isArray(list) ? list.slice(0, 60) : [];
    if (!list.length) throw new ApiError(400, 'Bo‘sh');
    await this.checkPostLimit(pid, list.length);
    const data = list.map((b) => ({ ...this.postFields(b, false), projectId: pid, authorId: uid }));
    await this.prisma.post.createMany({ data });
    await this.bump(pid);
    this.scheduler.rearm();
    return { added: data.length };
  }

  private async postAccess(postId: number, uid: number, need: 'viewer' | 'editor') {
    const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { id: true, projectId: true, title: true } });
    if (!post) throw new ApiError(404, 'Post topilmadi');
    return { post, ...(await this.access(post.projectId, uid, need)) };
  }

  async updatePost(uid: number, id: number, b: any) {
    const { post } = await this.postAccess(id, uid, 'editor');
    const f = this.postFields(b, true);
    await this.prisma.post.update({ where: { id }, data: f });
    await this.bump(post.projectId);
    if ('remindAt' in f) this.scheduler.rearm();
    return { ok: true };
  }

  async deletePost(uid: number, id: number) {
    const { post } = await this.postAccess(id, uid, 'editor');
    await this.prisma.post.delete({ where: { id } });
    await this.bump(post.projectId);
    return { ok: true };
  }

  // ---------------------------------------------------------------- reviews & comments
  async vote(uid: number, id: number, value: number) {
    const { post } = await this.postAccess(id, uid, 'viewer');
    const v = Math.sign(Number(value) || 0);
    if (v) await this.prisma.vote.upsert({ where: { postId_userId: { postId: id, userId: uid } }, create: { postId: id, userId: uid, v }, update: { v, at: new Date() } });
    else await this.prisma.vote.deleteMany({ where: { postId: id, userId: uid } });
    await this.bump(post.projectId);
    if (v) void this.notify.feedback(post.projectId, uid, { vote: v, postTitle: post.title });
    return { ok: true };
  }

  async comments(uid: number, id: number) {
    const { post, p } = await this.postAccess(id, uid, 'viewer');
    const list = await this.prisma.comment.findMany({ where: { postId: post.id }, orderBy: { id: 'asc' }, include: { user: { select: { name: true } } } });
    return { rev: p.rev, comments: list.map((c) => ({ id: c.id, uid: Number(c.userId), name: c.user.name, text: c.text, at: ms(c.at) })) };
  }

  async comment(uid: number, id: number, text: string) {
    const { post } = await this.postAccess(id, uid, 'viewer');
    text = str(text, 1000);
    if (!text) throw new ApiError(400, 'Izoh bo‘sh');
    const c = await this.prisma.comment.create({ data: { postId: id, userId: uid, text } });
    await this.bump(post.projectId);
    void this.notify.feedback(post.projectId, uid, { comment: text, postTitle: post.title });
    return { id: c.id };
  }

  async deleteComment(uid: number, id: number) {
    const c = await this.prisma.comment.findUnique({ where: { id }, include: { post: { select: { projectId: true } } } });
    if (!c) throw new ApiError(404, 'Topilmadi');
    if (Number(c.userId) !== uid) await this.access(c.post.projectId, uid, 'owner');
    await this.prisma.comment.delete({ where: { id } });
    await this.bump(c.post.projectId);
    return { ok: true };
  }
}
