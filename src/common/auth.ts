// Telegram Mini App authentication. Every request carries Telegram's signed launch data:
//   Authorization: tma <initData>
// checked with HMAC-SHA256 keyed by the bot token — a bare user id would be trivial to fake.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'crypto';
import { conf, isAdmin } from './config';
import { ApiError } from './errors';
import { UsersService } from '../users/users.service';

export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };

let secret: Buffer | null = null;
const seen = new Map<string, { user: TgUser; authDate: number }>(); // same launch data is verified once
const MAX_SEEN = 10_000;

export function verifyInitData(raw: string, maxAgeSec = 7 * 86400): TgUser | null {
  const { token } = conf();
  if (!raw || !token || raw.length > 4096) return null;
  const now = Math.floor(Date.now() / 1000);
  const hit = seen.get(raw);
  if (hit) return now - hit.authDate <= maxAgeSec ? hit.user : null;

  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  secret ||= createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date') || 0);
  let user: TgUser | null = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {}
  if (!user?.id) return null;
  if (seen.size >= MAX_SEEN) seen.delete(seen.keys().next().value);
  seen.set(raw, { user, authDate });
  return now - authDate <= maxAgeSec ? user : null;
}

function userFromHeader(h = ''): TgUser | null {
  if (h.startsWith('tma ')) return verifyInitData(h.slice(4));
  // local development only (DEV_AUTH=1, not production): "Authorization: dev <id> <name>"
  if (conf().devAuth && h.startsWith('dev ')) {
    const [, id, ...name] = h.split(' ');
    if (/^\d{1,15}$/.test(id)) return { id: Number(id), first_name: name.join(' ') || `User ${id}` };
  }
  return null;
}

// a token bucket per user for writes: 120 burst, refills 2/s
const buckets = new Map<number, { t: number; n: number }>();
setInterval(() => {
  const old = Date.now() - 120_000;
  for (const [k, b] of buckets) if (b.t < old) buckets.delete(k);
}, 60_000).unref();
function allow(uid: number) {
  const now = Date.now();
  const b = buckets.get(uid) || { t: now, n: 120 };
  b.n = Math.min(120, b.n + ((now - b.t) / 1000) * 2);
  b.t = now;
  if (b.n < 1) return false;
  b.n--;
  buckets.set(uid, b);
  return true;
}

export const ADMIN_ONLY = 'adminOnly';
/** Marks a controller or handler as admin-only (ADMIN_TELEGRAM_ID from .env). */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

@Injectable()
export class TgAuthGuard implements CanActivate {
  constructor(private users: UsersService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const tu = userFromHeader(req.headers.authorization);
    if (!tu) throw new ApiError(401, 'Telegram orqali oching');
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [ctx.getHandler(), ctx.getClass()]);
    if (adminOnly && !isAdmin(tu.id)) throw new ApiError(403, 'forbidden');
    const write = req.method !== 'GET';
    if (write && !allow(tu.id)) throw new ApiError(429, 'Juda tez. Biroz kuting.');
    await this.users.ensure(tu);
    this.users.markSeen(tu.id, write);
    req.tgUser = tu;
    return true;
  }
}

/** The caller's Telegram id (number). */
export const Uid = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().tgUser.id as number);
