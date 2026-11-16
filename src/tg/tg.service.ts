// One Telegraf instance for the whole app + an outgoing message queue that stays under Telegram's
// limit (~30 messages/s), so reminders due in the same minute are never dropped.
import { Injectable, Logger } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { conf } from '../common/config';

type Job = { chatId: number; text: string; extra: any; resolve: (m: any) => void };
const PER_SEC = 25;

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Inline button that opens the Mini App, optionally on a screen (?p=<project>&post=<post>, ?v=team ...). */
export const appButton = (text: string, query = '') => ({ text, web_app: { url: conf().webappUrl + (query ? `?${query}` : '') } });
export const appKeyboard = (text: string, query = '') => ({ reply_markup: { inline_keyboard: [[appButton(text, query)]] } });

@Injectable()
export class TgService {
  private readonly logger = new Logger('Tg');
  readonly bot: Telegraf;
  readonly enabled: boolean;
  private queue: Job[] = [];
  private pumping = false;

  constructor(private prisma: PrismaService) {
    this.enabled = !!conf().token;
    this.bot = new Telegraf(conf().token || '0:none');
  }

  get api() {
    return this.bot.telegram;
  }

  /** Queues an HTML message. Resolves with the sent message, or null (bot blocked, disabled, error). */
  send(chatId: number | bigint, text: string, extra: any = {}): Promise<any> {
    if (!this.enabled || !chatId) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.queue.push({ chatId: Number(chatId), text, extra, resolve });
      if (!this.pumping) void this.pump();
    });
  }

  private async pump() {
    this.pumping = true;
    while (this.queue.length) {
      const batch = this.queue.splice(0, PER_SEC);
      const started = Date.now();
      await Promise.all(
        batch.map(async ({ chatId, text, extra, resolve }) => {
          try {
            resolve(await this.api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra }));
          } catch (e: any) {
            const code = e?.response?.error_code;
            if (code === 403) await this.prisma.user.updateMany({ where: { id: chatId }, data: { blocked: true } }).catch(() => {});
            else if (code === 429) {
              this.queue.unshift({ chatId, text, extra, resolve }); // retry after the pause below
              await new Promise((r) => setTimeout(r, (e.response.parameters?.retry_after || 1) * 1000));
              return;
            } else this.logger.warn(`send to ${chatId} failed: ${e?.message}`);
            resolve(null);
          }
        }),
      );
      const wait = 1000 - (Date.now() - started);
      if (this.queue.length && wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    this.pumping = false;
  }
}
