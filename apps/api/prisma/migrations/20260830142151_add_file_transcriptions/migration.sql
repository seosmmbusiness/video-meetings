-- CreateEnum
CREATE TYPE "TranscriptionState" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "file_transcriptions" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "state" "TranscriptionState" NOT NULL,
    "text" TEXT,
    "failureReason" VARCHAR(200),
    "engine" VARCHAR(32) NOT NULL,
    "model" VARCHAR(32) NOT NULL,
    "effort" VARCHAR(16) NOT NULL,
    "languageMode" VARCHAR(16) NOT NULL,
    "detectedLanguage" VARCHAR(64),
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_transcriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_transcriptions_fileId_key" ON "file_transcriptions"("fileId");

-- CreateIndex
CREATE INDEX "file_transcriptions_state_queuedAt_idx" ON "file_transcriptions"("state", "queuedAt");

-- AddForeignKey
ALTER TABLE "file_transcriptions" ADD CONSTRAINT "file_transcriptions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "meeting_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
