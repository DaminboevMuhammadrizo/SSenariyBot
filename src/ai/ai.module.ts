import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { BillingModule } from '../billing/billing.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [BillingModule, ProjectsModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
