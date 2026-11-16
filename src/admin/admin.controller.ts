import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminService } from './admin.service';
import { AdminOnly, TgAuthGuard, Uid } from '../common/auth';
import { etagOf, packJson, sendPack } from '../common/http';
import { int } from '../common/constants';

/** Only the Telegram id in ADMIN_TELEGRAM_ID (.env); checked from Telegram's signed launch data. */
@Controller('api/admin')
@UseGuards(TgAuthGuard)
@AdminOnly()
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('stats')
  async stats(@Req() req: Request, @Res() res: Response) {
    const body = await this.admin.stats();
    sendPack(req, res, packJson(body, etagOf(JSON.stringify(body)), 4));
  }

  @Get('plans')
  plans() {
    return this.admin.plansAndSettings();
  }

  @Put('plans/:id')
  savePlan(@Param('id') id: string, @Body() b: any) {
    return this.admin.savePlan(id, b || {});
  }

  @Delete('plans/:id')
  deletePlan(@Param('id') id: string) {
    return this.admin.deletePlan(id);
  }

  @Put('settings')
  settings(@Body() b: any) {
    return this.admin.saveSettings(b || {});
  }

  @Get('payments')
  payments(@Query('status') status = 'pending') {
    return this.admin.payments(status);
  }

  @Post('payments/:id')
  decide(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.admin.decide(uid, id, b?.action);
  }

  @Get('users')
  users(@Query('q') q = '', @Query('f') f = 'all', @Query('offset') offset = '0') {
    return this.admin.users(q, f, int(offset));
  }

  @Post('users/:id/grant')
  grant(@Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.admin.grant(id, b?.planId, b?.days);
  }

  @Post('broadcast')
  broadcast(@Body() b: any) {
    return this.admin.broadcast(b?.text);
  }
}
