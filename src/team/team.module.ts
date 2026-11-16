import { Module } from '@nestjs/common';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';
import { BillingModule } from '../billing/billing.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [BillingModule, SchedulerModule],
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
