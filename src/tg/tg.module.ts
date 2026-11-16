import { Global, Module } from '@nestjs/common';
import { TgService } from './tg.service';
import { NotifyService } from './notify.service';

/** Telegram client (sending) — global, so any module can message users without circular imports. */
@Global()
@Module({
  providers: [TgService, NotifyService],
  exports: [TgService, NotifyService],
})
export class TgModule {}
