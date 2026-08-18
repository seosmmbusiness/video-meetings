-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarKey" TEXT,
ADD COLUMN     "avatarMimeType" VARCHAR(64),
ADD COLUMN     "avatarSize" INTEGER,
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "name" VARCHAR(80),
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "users_avatarKey_key" ON "users"("avatarKey");
