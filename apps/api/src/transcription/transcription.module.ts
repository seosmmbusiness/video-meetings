import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TranscriptionEngine } from './transcription-engine';
import { WhisperCppEngine } from './whisper-cpp.engine';

/**
 * Owns turning a stored recording into text. It binds the
 * {@link TranscriptionEngine} boundary to {@link WhisperCppEngine} and exports
 * it — the same shape `StorageModule` gives `FileStorage`, so a feature that
 * needs a transcription imports this module rather than the engine's file, and
 * a spec overrides one token to run without an engine on the machine (D-1).
 */
@Module({
  imports: [StorageModule],
  providers: [{ provide: TranscriptionEngine, useClass: WhisperCppEngine }],
  exports: [TranscriptionEngine],
})
export class TranscriptionModule {}
