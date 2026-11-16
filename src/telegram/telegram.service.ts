// Telegram bot: opens the Mini App, accepts payment receipts and Telegram Payments, lets the admin
// approve payments with one tap, relays support messages both ways.
// WEBHOOK_DOMAIN set → webhook (POST /webhook); otherwise long polling (local development).
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { TgService, esc } from '../tg/tg.service';
import { BillingService } from '../billing/billing.service';
import { TeamService } from '../team/team.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { AdminService } from '../admin/admin.service';
import { conf, isAdmin } from '../common/config';
import { MESSAGES } from './messages';
import { ADMIN_COMMANDS, USER_COMMANDS, openAppKeyboard, paymentDecisionKeyboard } from './keyboards';

@Injectable()
export class TelegramService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private polling = false;

  constructor(
    private prisma: PrismaService,
    private tg: TgService,
    private billing: BillingService,
    private team: TeamService,
    private scheduler: SchedulerService,
    private admin: AdminService,
  ) {}

  private get bot() {
    return this.tg.bot;
  }

  async onApplicationBootstrap() {
    if (!this.tg.enabled) return this.logger.warn('TELEGRAM_BOT_TOKEN yo‘q — bot o‘chirilgan, faqat web');
    this.registerHandlers();
    void this.start(); // in the background: the web app keeps working while Telegram is unreachable
  }

  private async start(attempt = 1) {
    const c = conf();
    try {
      const me = await this.bot.telegram.getMe();
      c.botUsername ||= me.username;
      this.bot.botInfo = me;
      await this.setupCommands();
      if (c.webhookDomain) {
        await this.bot.telegram.setWebhook(`${c.webhookDomain}${c.webhookPath}`, {
          allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
          secret_token: c.webhookSecret || undefined,
          drop_pending_updates: false,
        });
        this.logger.log(`@${me.username} webhook: ${c.webhookDomain}${c.webhookPath}`);
      } else {
        this.logger.warn(`@${me.username}: WEBHOOK_DOMAIN yo‘q — polling mode`);
        await this.bot.telegram.deleteWebhook();
        this.polling = true;
        void this.bot.launch({ allowedUpdates: ['message', 'callback_query', 'pre_checkout_query'] }).catch((e) => this.logger.error(`polling: ${e.message}`));
      }
    } catch (e) {
      const wait = Math.min(60, 5 * attempt);
      this.logger.error(`bot start failed (${(e as Error).message}), retry in ${wait} s`);
      setTimeout(() => void this.start(attempt + 1), wait * 1000).unref();
    }
  }

  private async setupCommands() {
    const c = conf();
    await this.bot.telegram.setMyCommands(USER_COMMANDS);
    for (const id of c.admins) await this.bot.telegram.setMyCommands(ADMIN_COMMANDS, { scope: { type: 'chat', chat_id: id } }).catch(() => {});
    if (c.webappUrl.startsWith('https://'))
      await this.bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Tartib', web_app: { url: c.webappUrl } } }).catch((e) => this.logger.warn(`menu button: ${e.message}`));
  }

  handleWebhookUpdate(update: any) {
    return this.bot.handleUpdate(update);
  }

  onModuleDestroy() {
    if (this.polling) this.bot.stop('shutdown');
  }

  // ---------------------------------------------------------------- handlers
  private registerHandlers() {
    const b = this.bot;
    b.use(async (ctx, next) => {
      if (ctx.from && !ctx.from.is_bot && ctx.chat?.type === 'private') await this.upsertUser(ctx.from);
      return next();
    });
    b.start((ctx) => this.handleStart(ctx));
    b.command('admin', (ctx) => this.adminOnly(ctx, () => ctx.reply('Admin panel', openAppKeyboard('Admin panel', 'v=admin'))));
    b.command('stats', (ctx) => this.adminOnly(ctx, async () => ctx.reply(MESSAGES.stats(await this.admin.stats()), { parse_mode: 'HTML' })));
    b.command('backup', (ctx) => this.adminOnly(ctx, async () => ctx.reply(await this.scheduler.backup(true))));
    b.command('grant', (ctx) => this.adminOnly(ctx, () => this.handleGrant(ctx)));
    b.on('pre_checkout_query', (ctx) => this.handlePreCheckout(ctx));
    b.on('successful_payment' as any, (ctx: Context) => this.handleSuccessfulPayment(ctx));
    b.action(/^pay:(ok|no):(\d+)$/, (ctx) => this.handlePaymentDecision(ctx));
    b.on('message', (ctx) => this.handleMessage(ctx));
    b.catch((e: any) => this.logger.error(`update failed: ${e?.message}`));
  }

  private async upsertUser(from: { id: number; first_name: string; last_name?: string; username?: string }) {
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ').slice(0, 80);
    await this.prisma.user.upsert({ where: { id: from.id }, create: { id: from.id, name, username: from.username || null }, update: { name, username: from.username || null, blocked: false } });
  }

  private async adminOnly(ctx: Context, fn: () => unknown): Promise<void> {
    if (ctx.chat?.type !== 'private' || !isAdmin(ctx.from!.id)) return;
    await fn();
  }

  private async handleStart(ctx: Context) {
    if (ctx.chat?.type !== 'private') return;
    const param = ((ctx as any).payload || '').trim();
    if (param.startsWith('t_')) {
      try {
        await this.team.joinTeam(ctx.from!.id, param.slice(2));
        return void (await ctx.reply(MESSAGES.joinedTeam, openAppKeyboard('Jamoani ochish', 'v=team')));
      } catch (e) {
        return void (await ctx.reply(`⚠️ ${(e as Error).message}`));
      }
    }
    await ctx.reply(MESSAGES.welcome(ctx.from!.first_name), { parse_mode: 'HTML', ...openAppKeyboard('Tartibni ochish', param.startsWith('j_') ? `join=${param}` : '') });
  }

  private async handleGrant(ctx: Context) {
    const [, uid, planId, days] = ((ctx.message as any)?.text || '').split(/\s+/);
    try {
      const r = await this.billing.grant(Number(uid), planId, Number(days) || 30);
      await ctx.reply(`✅ ${uid}: ${this.billing.plans.get(planId)?.name || planId} — ${r.until ? new Date(r.until).toISOString().slice(0, 10) : 'bepul'}`);
    } catch (e) {
      await ctx.reply(`⚠️ ${(e as Error).message}\n${MESSAGES.grantUsage}`);
    }
  }

  private async handlePreCheckout(ctx: Context) {
    const q = ctx.preCheckoutQuery!;
    const id = Number((q.invoice_payload || '').split(':')[1]);
    const p = await this.prisma.payment.findUnique({ where: { id } });
    const ok = !!p && p.status === 'new' && Number(p.userId) === q.from.id && p.amount * 100 === q.total_amount;
    await ctx.answerPreCheckoutQuery(ok, ok ? undefined : 'To‘lov eskirgan. Ilovadan qaytadan urinib ko‘ring.');
  }

  private async handleSuccessfulPayment(ctx: Context) {
    const sp = (ctx.message as any).successful_payment;
    const id = Number(String(sp.invoice_payload).split(':')[1]);
    const r = await this.billing.activate(id);
    if (r) void this.tg.send(conf().adminChat, `💳 Telegram to‘lov #${id}: ${esc(ctx.from!.first_name)} · ${esc(r.title)} · ${r.p.amount} so‘m`);
  }

  private async handlePaymentDecision(ctx: Context & { match: RegExpExecArray }) {
    if (!isAdmin(ctx.from!.id)) return ctx.answerCbQuery();
    const [, action, id] = ctx.match;
    const r = action === 'ok' ? await this.billing.activate(Number(id), ctx.from!.id) : await this.billing.reject(Number(id), ctx.from!.id);
    this.admin.invalidate();
    await ctx.answerCbQuery(r ? (action === 'ok' ? 'Tasdiqlandi' : 'Rad etildi') : 'Allaqachon ko‘rib chiqilgan');
    const msg = ctx.callbackQuery?.message as any;
    if (msg) {
      const mark = r ? (action === 'ok' ? '\n\n✅ TASDIQLANDI' : '\n\n❌ RAD ETILDI') : '\n\n· ko‘rib chiqilgan';
      await ctx.editMessageCaption((msg.caption || '') + mark).catch(() => {});
    }
  }

  private async handleMessage(ctx: Context) {
    if (ctx.chat?.type !== 'private') return;
    const m: any = ctx.message;
    const from = ctx.from!;
    const admin = isAdmin(from.id);
    const c = conf();
    const who = `${esc(from.first_name)}${from.username ? ` @${esc(from.username)}` : ''}`;

    // admin replies to a forwarded support message → goes back to that user
    if (admin && m.reply_to_message) {
      const s = await this.prisma.support.findUnique({ where: { msgId: m.reply_to_message.message_id } });
      if (s) {
        await ctx.telegram.copyMessage(Number(s.userId), m.chat.id, m.message_id).catch((e) => ctx.reply(`⚠️ ${e.message}`));
        return;
      }
    }

    // a payment receipt (photo or file) while a card payment is waiting for one
    const fileId: string | undefined = m.photo?.at(-1)?.file_id || m.document?.file_id;
    const u = await this.prisma.user.findUnique({ where: { id: from.id }, select: { state: true } });
    if (fileId && u?.state?.startsWith('receipt:')) {
      const id = Number(u.state.split(':')[1]);
      const p = await this.prisma.payment.findFirst({ where: { id, userId: from.id } });
      await this.prisma.user.update({ where: { id: from.id }, data: { state: null } });
      if (p && (p.status === 'new' || p.status === 'pending')) {
        await this.prisma.payment.update({ where: { id }, data: { status: 'pending', fileId } });
        const what = p.kind === 'team' ? `Jamoa · ${p.seats} kishi${p.teamName ? ` · ${esc(p.teamName)}` : ''}` : esc(this.billing.plans.get(p.planId!)?.name || p.planId);
        const caption = MESSAGES.receiptToAdmin(id, who, from.id, what, p.period, p.amount);
        const extra = { caption, parse_mode: 'HTML' as const, reply_markup: paymentDecisionKeyboard(id) };
        await (m.photo ? ctx.telegram.sendPhoto(c.adminChat, fileId, extra) : ctx.telegram.sendDocument(c.adminChat, fileId, extra)).catch((e) => this.logger.error(`receipt forward: ${e.message}`));
        return void (await ctx.reply(MESSAGES.receiptAccepted));
      }
    }

    // anything else: a support message to the admin
    if (!admin && c.adminChat) {
      try {
        const head = await ctx.telegram.sendMessage(c.adminChat, MESSAGES.supportHead(who, from.id), { parse_mode: 'HTML' });
        const copy = await ctx.telegram.copyMessage(c.adminChat, m.chat.id, m.message_id, { reply_parameters: { message_id: head.message_id } } as any);
        await this.prisma.support.createMany({
          data: [
            { msgId: head.message_id, userId: from.id },
            { msgId: copy.message_id, userId: from.id },
          ],
          skipDuplicates: true,
        });
        await ctx.reply(MESSAGES.supportSent, openAppKeyboard());
      } catch (e) {
        this.logger.error(`support relay: ${(e as Error).message}`);
      }
    }
  }
}
