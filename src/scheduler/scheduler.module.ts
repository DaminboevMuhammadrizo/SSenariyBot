import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
