import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProjectsService } from './projects.service';
import { TgAuthGuard, Uid } from '../common/auth';
import { etagOf, fresh, packJson, sendPack } from '../common/http';

@Controller('api')
@UseGuards(TgAuthGuard)
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  /** GET /api/boot — the home screen in one request; 304 when nothing changed. */
  @Get('boot')
  async boot(@Uid() uid: number, @Req() req: Request, @Res() res: Response) {
    const body = await this.projects.boot(uid);
    sendPack(req, res, packJson(body, etagOf(JSON.stringify(body)), 4));
  }

  @Post('projects')
  create(@Uid() uid: number, @Body() b: any) {
    return this.projects.create(uid, b || {});
  }

  /** The full project. ETag = "p<id>.<rev>": checked before anything is built. */
  @Get('projects/:id')
  async get(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Req() req: Request, @Res() res: Response) {
    const { p } = await this.projects.access(id, uid);
    const etag = `"p${p.id}.${p.rev}"`;
    if (fresh(req, etag)) return void res.status(304).setHeader('etag', etag).end();
    sendPack(req, res, await this.projects.payload(p.id, p.rev, etag));
  }

  @Patch('projects/:id')
  update(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.projects.update(uid, id, b || {});
  }

  @Delete('projects/:id')
  remove(@Uid() uid: number, @Param('id', ParseIntPipe) id: number) {
    return this.projects.remove(uid, id);
  }

  @Post('projects/:id/share')
  share(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.projects.share(uid, id, !!b?.reset);
  }

  @Patch('projects/:id/members/:uid')
  memberRole(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Param('uid', ParseIntPipe) member: number, @Body() b: any) {
    return this.projects.setMemberRole(uid, id, member, b?.role);
  }

  @Delete('projects/:id/members/:uid')
  memberRemove(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Param('uid', ParseIntPipe) member: number) {
    return this.projects.removeMember(uid, id, member);
  }

  @Post('join')
  join(@Uid() uid: number, @Body() b: any) {
    return this.projects.join(uid, b?.code);
  }

  @Post('projects/:id/posts')
  createPost(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.projects.createPost(uid, id, b || {});
  }

  @Post('projects/:id/posts/bulk')
  createPosts(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.projects.createPosts(uid, id, b?.posts);
  }

  @Patch('posts/:id')
  updatePost(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.projects.updatePost(uid, id, b || {});
  }

  @Delete('posts/:id')
  deletePost(@Uid() uid: number, @Param('id', ParseIntPipe) id: number) {
    return this.projects.deletePost(uid, id);
  }

  @Post('posts/:id/vote')
  vote(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.projects.vote(uid, id, b?.v);
  }

  @Get('posts/:id/comments')
  comments(@Uid() uid: number, @Param('id', ParseIntPipe) id: number) {
    return this.projects.comments(uid, id);
  }

  @Post('posts/:id/comments')
  comment(@Uid() uid: number, @Param('id', ParseIntPipe) id: number, @Body() b: any) {
    return this.projects.comment(uid, id, b?.text);
  }

  @Delete('comments/:id')
  deleteComment(@Uid() uid: number, @Param('id', ParseIntPipe) id: number) {
    return this.projects.deleteComment(uid, id);
  }
}
