import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors';
import { conf } from './common/config';
import { ProjectsService } from './projects/projects.service';

// Telegram ids are BigInt in Postgres; anything that slips into JSON is sent as a plain number
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('etag', false); // ETags are ours (versioned), not Express's body hashes
  app.useBodyParser('json', { limit: '512kb' });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000; // longer than nginx's, so connections are reused
  server.headersTimeout = 66_000;

  const port = conf().port;
  await app.listen(port, '0.0.0.0');
  Logger.log(`Server running on port ${port}`, 'Main');

  // memory guard: give cache memory back long before the container limit
  const cache = app.get(ProjectsService).cache;
  setInterval(() => {
    const rss = process.memoryUsage.rss() / 2 ** 20;
    if (rss > conf().rssSoftMb) {
      cache.shrink(0.5);
      Logger.warn(`rss ${Math.round(rss)} MB > ${conf().rssSoftMb} MB: cache shrunk to ${cache.info().mb} MB`, 'Main');
    }
  }, 30_000).unref();
}

bootstrap();
