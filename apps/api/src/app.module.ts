import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CredentialsModule } from './credentials/credentials.module';
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
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    // Registered once, app-wide (it's a global module): backs the
    // CommandBus/QueryBus that Auth uses to talk to Users and Credentials.
    CqrsModule.forRoot(),
    PrismaModule,
    UsersModule,
    CredentialsModule,
    AuthModule,
    MeetingsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
