import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TgAuthGuard, Uid } from '../common/auth';
import { ApiError } from '../common/errors';

@Controller('api')
@UseGuards(TgAuthGuard)
export class UsersController {
  constructor(private prisma: PrismaService) {}

  /** POST /api/me { prefs } — small per-user settings (theme, default reminder). */
  @Post('me')
  async me(@Uid() uid: number, @Body() body: any) {
    const prefs = body?.prefs && typeof body.prefs === 'object' ? body.prefs : {};
    if (JSON.stringify(prefs).length > 1024) throw new ApiError(400, 'Juda katta');
    await this.prisma.user.update({ where: { id: uid }, data: { prefs } });
    return { ok: true };
  }
}
