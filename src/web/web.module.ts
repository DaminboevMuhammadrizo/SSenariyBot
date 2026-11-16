import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { WebMiddleware, WebService } from './web.service';

@Module({
  providers: [WebService, WebMiddleware],
})
export class WebModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(WebMiddleware).forRoutes('*');
  }
}
