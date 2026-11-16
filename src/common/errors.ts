import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** API error with a user-facing Uzbek message; `extra` (e.g. { upgrade: true }) goes to the client too. */
export class ApiError extends HttpException {
  constructor(status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message, status);
  }
}

/** Every error leaves as { error: "...", ...extra } — the shape the Mini App expects. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest();
    if (res.headersSent) return;
    if (e instanceof ApiError) return void res.status(e.getStatus()).json({ error: e.message, ...e.extra });
    if (e instanceof HttpException) {
      const r = e.getResponse() as any;
      return void res.status(e.getStatus()).json({ error: typeof r === 'string' ? r : Array.isArray(r?.message) ? r.message.join(', ') : r?.message || e.message });
    }
    this.logger.error(`${req.method} ${req.url}: ${(e as Error)?.stack || e}`);
    res.status(500).json({ error: 'Server xatosi' });
  }
}
