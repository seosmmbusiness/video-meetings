import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * Owns the signed-in caller's self-service routes (D-1); depends on
 * {@link AuthModule} for the JWT guard that protects every one of them and on
 * {@link StorageModule} for the avatar's bytes (D-4), and reaches persistence
 * only over the CQRS buses.
 */
@Module({
  imports: [AuthModule, StorageModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
