-- Shorts Factory Reel Studio: AI reel projects (brand-based and general topic).
-- Additive only: one new table, no changes to existing tables.

-- CreateTable
CREATE TABLE "shorts_reels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT,
    "mode" TEXT NOT NULL,
    "reelType" TEXT,
    "topic" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "durationSec" INTEGER NOT NULL DEFAULT 30,
    "language" TEXT NOT NULL DEFAULT 'en',
    "productUrl" TEXT,
    "script" JSONB,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "renderInfo" JSONB,
    "llmLog" JSONB,
    "renderCount" INTEGER NOT NULL DEFAULT 0,
    "filePath" TEXT,
    "thumbPath" TEXT,
    "videoDurationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fileSizeBytes" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shorts_reels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shorts_reels_userId_createdAt_idx" ON "shorts_reels"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "shorts_reels_brandId_idx" ON "shorts_reels"("brandId");

-- CreateIndex
CREATE INDEX "shorts_reels_status_idx" ON "shorts_reels"("status");

-- AddForeignKey
ALTER TABLE "shorts_reels" ADD CONSTRAINT "shorts_reels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_reels" ADD CONSTRAINT "shorts_reels_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
