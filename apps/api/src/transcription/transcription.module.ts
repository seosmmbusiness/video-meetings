import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { StorageModule } from '../storage/storage.module';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionEngine } from './transcription-engine';
import { TranscriptionService } from './transcription.service';
import { WhisperCppEngine } from './whisper-cpp.engine';

/**
 * Owns turning a stored recording into text. It binds the
 * {@link TranscriptionEngine} boundary to {@link WhisperCppEngine} and exports
 * it — the same shape `StorageModule` gives `FileStorage`, so a feature that
 * needs a transcription imports this module rather than the engine's file, and
 * a spec overrides one token to run without an engine on the machine (D-1).
 *
 * It reaches an owner's file only through {@link FilesModule}'s public
 * surface — `FilesService` and `MeetingOwnerGuard`, never a copied ownership
 * `where` clause (D-9) — and through {@link MeetingsModule} for the one route
 * that carries no `:fileId` and so has nothing for `findFileForOwner` to
 * resolve (S-1). Nothing imports this module back, so neither is a cycle.
 */
@Module({
  imports: [AuthModule, FilesModule, MeetingsModule, StorageModule],
  controllers: [TranscriptionController],
  providers: [
    TranscriptionService,
    { provide: TranscriptionEngine, useClass: WhisperCppEngine },
  ],
  exports: [TranscriptionEngine],
})
export class TranscriptionModule {}
