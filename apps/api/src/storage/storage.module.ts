import { Module } from '@nestjs/common';
import { FileStorage } from './file-storage';
import { FileTypeService } from './file-type.service';
import { LocalDiskFileStorage } from './local-disk-file-storage';

/**
 * Owns byte storage for the whole app: it binds the {@link FileStorage}
 * boundary to {@link LocalDiskFileStorage} and exports it, alongside the
 * {@link FileTypeService} that decides what a staged file really is, so a
 * feature that needs to read, write or vet bytes imports this module rather
 * than another feature (D-4). That is what lets `profile` store an avatar
 * without pulling in the meeting-files controller, its purge cron and its
 * quota service.
 */
@Module({
  providers: [
    { provide: FileStorage, useClass: LocalDiskFileStorage },
    FileTypeService,
  ],
  exports: [FileStorage, FileTypeService],
})
export class StorageModule {}
