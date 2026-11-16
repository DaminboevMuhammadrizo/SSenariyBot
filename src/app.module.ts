import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { TgModule } from './tg/tg.module';
import { UsersModule } from './users/users.module';
import { BillingModule } from './billing/billing.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TeamModule } from './team/team.module';
import { ProjectsModule } from './projects/projects.module';
import { AiModule } from './ai/ai.module';
import { AdminModule } from './admin/admin.module';
import { TelegramModule } from './telegram/telegram.module';
import { WebModule } from './web/web.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TgModule,
    UsersModule,
    BillingModule,
    SchedulerModule,
    TeamModule,
    ProjectsModule,
    AiModule,
    AdminModule,
    TelegramModule,
    WebModule,
  ],
})
export class AppModule {}
