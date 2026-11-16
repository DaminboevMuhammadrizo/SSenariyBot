import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { TgAuthGuard, Uid } from '../common/auth';
import { ms } from '../common/time';

@Controller('api')
@UseGuards(TgAuthGuard)
export class BillingController {
  constructor(private billing: BillingService, private prisma: PrismaService) {}

  /** POST /api/pay { kind: plan|team, planId?, period: month|year, seats?, teamName? } */
  @Post('pay')
  pay(@Uid() uid: number, @Body() body: any) {
    return this.billing.createPayment(uid, body || {});
  }

  @Get('payments')
  async payments(@Uid() uid: number) {
    const rows = await this.prisma.payment.findMany({ where: { userId: uid }, orderBy: { id: 'desc' }, take: 10 });
    return { payments: rows.map((p) => ({ id: p.id, kind: p.kind, planId: p.planId, period: p.period, seats: p.seats, amount: p.amount, status: p.status, at: ms(p.createdAt) })) };
  }
}
