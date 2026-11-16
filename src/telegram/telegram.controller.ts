import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { conf } from '../common/config';

@Controller()
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private telegramService: TelegramService) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Body() body: any, @Headers('x-telegram-bot-api-secret-token') secret?: string) {
    const expected = conf().webhookSecret;
    if (expected && secret !== expected) return { ok: false }; // not from Telegram
    try {
      await this.telegramService.handleWebhookUpdate(body);
    } catch (err) {
      this.logger.error(`Webhook xatosi: ${(err as Error).message}`);
    }
    return { ok: true };
  }
}
