import type { Server } from 'http';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * Bootstraps the Nest application: builds the module graph, enables
 * request DTO validation, allows cross-origin requests from the web app,
 * mounts the Swagger UI at `/api`, and starts the HTTP listener.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // apps/web runs on a different origin/port in dev (and, later, prod), so
  // the browser needs an explicit CORS allow-list. No cookies are used
  // (JWTs travel in the Authorization header), so credentials aren't needed.
  const configService = app.get(ConfigService);
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN', 'http://localhost:3000'),
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('video-meetings API')
    .setDescription('HTTP API for the video-meetings backend')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument);

  // Node's default requestTimeout (300s) caps a 500 MB upload at ~14 Mbit/s;
  // raised to 30 min (~2.3 Mbit/s) so a slower link isn't refused outright
  // (D-3, task 2.1). headersTimeout stays at its 60s default — only the
  // upload route's own inactivity timeout (S-9) polices a stalled body.
  (app.getHttpServer() as Server).requestTimeout = 1_800_000;

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
