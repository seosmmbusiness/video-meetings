import { createHash } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CredentialsModule } from './credentials/credentials.module';
import { FilesModule } from './files/files.module';
import { MeetingsModule } from './meetings/meetings.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // apps/api is always run with cwd=apps/api (npm workspace scripts), and
    // the repo keeps a single .env two levels up, at the monorepo root.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    // Baseline rate limit applied to every route; auth endpoints layer a
    // stricter override on top (see AuthController) to blunt brute-forcing.
    // Tracked by credential rather than socket: apps/web calls this API
    // server-to-server, so every user's traffic would otherwise share one
    // IP bucket behind that proxy (APP_GUARD guards run before controller
    // guards, so `req.user` isn't set yet — hashing the raw header avoids
    // decoding it twice, and keeps the token itself out of throttler
    // storage/logs).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 20 }],
      getTracker: (req: {
        headers: { authorization?: string };
        ip?: string;
      }) => {
        const { authorization } = req.headers;
        return authorization
          ? createHash('sha256').update(authorization).digest('hex')
          : String(req.ip);
      },
    }),
    // Registered once, app-wide (it's a global module): backs the
    // CommandBus/QueryBus that Auth uses to talk to Users and Credentials.
    CqrsModule.forRoot(),
    // Backs FilesPurgeService's hourly @Cron (D-8).
    ScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    CredentialsModule,
    AuthModule,
    MeetingsModule,
    FilesModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
