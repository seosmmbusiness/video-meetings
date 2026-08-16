import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

/**
 * Wires up the meetings controller and service; depends on {@link AuthModule}
 * for the JWT guard used to protect every route.
 */
@Module({
  imports: [AuthModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
