// Feedback digests: votes and comments on a project are collected for a short while and sent as one
// message ("Loyiha X — yangi fikrlar: 👍 3  💬 2") instead of one message per tap.
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TgService, esc, appKeyboard } from './tg.service';

const WAIT = 90_000;
type Digest = { uid: number; pid: number; name: string; up: number; down: number; comments: { actor: string; text: string; postTitle: string }[]; timer?: NodeJS.Timeout };

@Injectable()
export class NotifyService implements OnModuleDestroy {
  private pending = new Map<string, Digest>();

  constructor(private prisma: PrismaService, private tg: TgService) {}

  /** Someone (actor) reacted in project pid: tell the owner and the editors, never the actor. */
  async feedback(pid: number, actorId: number, f: { vote?: number; comment?: string; postTitle: string }) {
    const p = await this.prisma.project.findUnique({ where: { id: pid }, select: { name: true, ownerId: true, members: { where: { role: 'editor' }, select: { userId: true } } } });
    if (!p) return;
    const to = new Set([Number(p.ownerId), ...p.members.map((m) => Number(m.userId))]);
    to.delete(actorId);
    if (!to.size) return;
    const actor = (await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }))?.name || 'Kimdir';
    for (const uid of to) {
      const k = `${uid}:${pid}`;
      let d = this.pending.get(k);
      if (!d) this.pending.set(k, (d = { uid, pid, name: p.name, up: 0, down: 0, comments: [] }));
      if ((f.vote || 0) > 0) d.up++;
      if ((f.vote || 0) < 0) d.down++;
      if (f.comment) d.comments.push({ actor, text: f.comment, postTitle: f.postTitle });
      clearTimeout(d.timer);
      d.timer = setTimeout(() => this.flush(k), WAIT);
    }
  }

  private flush(k: string) {
    const d = this.pending.get(k);
    this.pending.delete(k);
    if (!d) return;
    clearTimeout(d.timer);
    const parts: string[] = [];
    if (d.up) parts.push(`👍 ${d.up}`);
    if (d.down) parts.push(`👎 ${d.down}`);
    if (d.comments.length) parts.push(`💬 ${d.comments.length}`);
    const shown = d.comments
      .slice(-3)
      .map((c) => `<b>${esc(c.actor)}</b> · ${esc(c.postTitle)}\n${esc(c.text.slice(0, 200))}`)
      .join('\n\n');
    void this.tg.send(d.uid, `<b>${esc(d.name)}</b> — yangi fikrlar: ${parts.join('  ')}${shown ? `\n\n${shown}` : ''}`, {
      ...appKeyboard('Ko‘rish', `p=${d.pid}`),
      disable_notification: !d.comments.length,
    });
  }

  onModuleDestroy() {
    for (const k of [...this.pending.keys()]) this.flush(k);
  }
}
