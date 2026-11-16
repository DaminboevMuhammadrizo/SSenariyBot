import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { BillingModule } from '../billing/billing.module';
import { TeamModule } from '../team/team.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [BillingModule, TeamModule, SchedulerModule, AdminModule],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
