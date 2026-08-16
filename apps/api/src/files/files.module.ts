import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { FileTypeService } from './file-type.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MeetingOwnerGuard } from './guards/meeting-owner.guard';
import { UploadSizeGuard } from './guards/upload-size.guard';
import { QuotaReservationService } from './quota-reservation.service';
import { FileStorage } from './storage/file-storage';
import { LocalDiskFileStorage } from './storage/local-disk-file-storage';

/**
 * Wires up the files controller and service. Depends on {@link AuthModule}
 * for the JWT guard and on {@link MeetingsModule} for
 * `MeetingsService.findOneForOwner`, which {@link MeetingOwnerGuard} reuses
 * rather than re-implementing ownership resolution.
 */
@Module({
  imports: [AuthModule, MeetingsModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    FileTypeService,
    QuotaReservationService,
    MeetingOwnerGuard,
    UploadSizeGuard,
    { provide: FileStorage, useClass: LocalDiskFileStorage },
  ],
})
export class FilesModule {}
