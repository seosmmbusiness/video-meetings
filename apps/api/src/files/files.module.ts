import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { StorageModule } from '../storage/storage.module';
import { FilesPurgeService } from './files-purge.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MeetingOwnerGuard } from './guards/meeting-owner.guard';
import { UploadSizeGuard } from './guards/upload-size.guard';
import { QuotaReservationService } from './quota-reservation.service';

/**
 * Wires up the files controller and service. Depends on {@link AuthModule}
 * for the JWT guard, on {@link MeetingsModule} for
 * `MeetingsService.findOneForOwner`, which {@link MeetingOwnerGuard} reuses
 * rather than re-implementing ownership resolution, and on
 * {@link StorageModule} for the `FileStorage` boundary and the
 * `FileTypeService` this module used to own itself (D-4).
 */
@Module({
  imports: [AuthModule, MeetingsModule, StorageModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    QuotaReservationService,
    FilesPurgeService,
    MeetingOwnerGuard,
    UploadSizeGuard,
  ],
  // The module's public surface, kept as narrow as the routes that need it:
  // `TranscriptionModule` resolves an owner's file through `FilesService` and
  // scopes its routes with `MeetingOwnerGuard` rather than copying either
  // rule — and never reaches `QuotaReservationService` or `FilesPurgeService`
  // (D-9, S-1).
  exports: [FilesService, MeetingOwnerGuard],
})
export class FilesModule {}
