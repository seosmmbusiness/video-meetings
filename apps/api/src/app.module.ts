import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  throttlerOptionsFromEnv,
  trackerFromRequest,
} from './config/throttler.config';
import { AuthModule } from './auth/auth.module';
import { CredentialsModule } from './credentials/credentials.module';
import { FilesModule } from './files/files.module';
import { MeetingsModule } from './meetings/meetings.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './profile/profile.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // apps/api is always run with cwd=apps/api (npm workspace scripts), and
    // the repo keeps a single .env two levels up, at the monorepo root.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    // Baseline rate limit applied to every route; auth endpoints layer a
    // stricter override on top (see AuthController) to blunt brute-forcing.
    // The baseline is what an unauthenticated caller shares by IP, which is
    // why it — and only it — is configurable (THROTTLE_LIMIT/THROTTLE_TTL_MS):
    // the whole web e2e suite registers fixtures through one bucket. The
    // route-level overrides that model the real controls stay hard-coded.
    // Tracked by credential rather than socket, because apps/web calls this
    // API server-to-server: see `trackerFromRequest`, which owns the rule and
    // is unit-tested against the header spellings passport-jwt accepts.
    // (APP_GUARD guards run before controller guards, so `req.user` isn't set
    // yet — the header is all this has to key on.)
    // forRootAsync, not forRoot: ConfigModule.forRoot() above is what loads the
    // root .env into process.env, and it has not run yet while this module's
    // metadata is being built — reading the ceiling eagerly would always see
    // the default.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          throttlerOptionsFromEnv({
            THROTTLE_TTL_MS: config.get<string>('THROTTLE_TTL_MS'),
            THROTTLE_LIMIT: config.get<string>('THROTTLE_LIMIT'),
          }),
        ],
        getTracker: trackerFromRequest,
      }),
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
    ProfileModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
