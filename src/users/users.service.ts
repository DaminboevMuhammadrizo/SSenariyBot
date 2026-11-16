import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dayKey } from '../common/time';
import type { TgUser } from '../common/auth';

@Injectable()
export class UsersService implements OnModuleDestroy {
  private readonly logger = new Logger(UsersService.name);
  // users are upserted on first contact after a restart; afterwards a Set lookup skips the database
  private known = new Set<number>();
  // "was here" and "did something" happen on almost every request: kept in two Maps, flushed every 15 s
  // as two statements instead of thousands of tiny transactions
  private seen = new Map<number, number>();
  private acts = new Map<string, number>();
  private timer = setInterval(() => void this.flush(), 15_000).unref();

  constructor(private prisma: PrismaService) {}

  async ensure(tu: TgUser) {
    if (this.known.has(tu.id)) return;
    if (this.known.size > 50_000) this.known.clear();
    const name = [tu.first_name, tu.last_name].filter(Boolean).join(' ').slice(0, 80);
    await this.prisma.user.upsert({
      where: { id: tu.id },
      create: { id: tu.id, name, username: tu.username || null },
      update: { name, username: tu.username || null, blocked: false },
    });
    this.known.add(tu.id);
  }

  markSeen(uid: number, action = false) {
    this.seen.set(uid, Date.now());
    const k = `${dayKey()}|${uid}`;
    this.acts.set(k, (this.acts.get(k) || 0) + (action ? 1 : 0));
  }

  async flush() {
    if (!this.seen.size && !this.acts.size) return;
    const seen = [...this.seen];
    const acts = [...this.acts];
    this.seen.clear();
    this.acts.clear();
    try {
      if (seen.length)
        await this.prisma.$executeRaw`
          UPDATE "User" AS u SET "lastSeen" = v.t
          FROM (VALUES ${Prisma.join(seen.map(([id, t]) => Prisma.sql`(${BigInt(id)}::bigint, ${new Date(t)}::timestamp)`))}) AS v(id, t)
          WHERE u.id = v.id AND u."lastSeen" < v.t`;
      if (acts.length)
        await this.prisma.$executeRaw`
          INSERT INTO "Activity"(day, "userId", n)
          VALUES ${Prisma.join(acts.map(([k, n]) => {
            const [day, uid] = k.split('|');
            return Prisma.sql`(${day}, ${BigInt(uid)}::bigint, ${n}::int)`;
          }))}
          ON CONFLICT (day, "userId") DO UPDATE SET n = "Activity".n + EXCLUDED.n`;
    } catch (e) {
      this.logger.error(`flush failed: ${(e as Error).message}`);
    }
  }

  get(uid: number) {
    return this.prisma.user.findUnique({ where: { id: uid } });
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.flush();
  }
}
