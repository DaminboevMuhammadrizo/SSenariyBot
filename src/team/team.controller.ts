import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TeamService } from './team.service';
import { TgAuthGuard, Uid } from '../common/auth';
import { etagOf, packJson, sendPack } from '../common/http';

@Controller('api')
@UseGuards(TgAuthGuard)
export class TeamController {
  constructor(private team: TeamService) {}

  /** GET /api/team — 304 when nothing changed since the client's copy. */
  @Get('team')
  async overview(@Uid() uid: number, @Req() req: Request, @Res() res: Response) {
    const body = await this.team.overview(uid);
    sendPack(req, res, packJson(body, etagOf(JSON.stringify(body)), 4));
  }

  @Patch('team')
  rename(@Uid() uid: number, @Body() b: any) {
    return this.team.rename(uid, b?.name);
  }

  @Post('team/invite')
  invite(@Uid() uid: number, @Body() b: any) {
    return this.team.invite(uid, !!b?.reset);
  }

  @Patch('team/members/:uid')
  role(@Uid() uid: number, @Param('uid', ParseIntPipe) member: number, @Body() b: any) {
    return this.team.setRole(uid, member, b?.role);
  }

  @Delete('team/members/:uid')
  remove(@Uid() uid: number, @Param('uid', ParseIntPipe) member: number) {
    return this.team.removeMember(uid, member);
  }

  @Post('team/tasks')
  create(@Uid() uid: number, @Body() b: any) {
    return this.team.createTask(uid, b || {});
  }

  /** PATCH /api/tasks/:id { action: done|approve|reject|reopen, note } or field edits (boss). */
  @Patch('tasks/:id')
  update(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.team.updateTask(uid, id, b || {});
  }

  @Delete('tasks/:id')
  remove2(@Uid() uid: number, @Param('id', ParseIntPipe) id: number) {
    return this.team.deleteTask(uid, id);
  }
}
