import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { TgAuthGuard, Uid } from '../common/auth';

@Controller('api')
@UseGuards(TgAuthGuard)
export class AiController {
  constructor(private ai: AiService) {}

  /** POST /api/ai { kind: plan|caption|improve|hashtags, projectId, ... } */
  @Post('ai')
  run(@Uid() uid: number, @Body() b: any) {
    return this.ai.run(uid, b || {});
  }
}
