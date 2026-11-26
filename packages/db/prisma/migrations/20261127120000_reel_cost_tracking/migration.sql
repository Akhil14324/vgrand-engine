-- Reel Studio autonomous generator: tracked spend per reel.
-- Additive only: two new columns with defaults, no changes to existing data.

-- AlterTable
ALTER TABLE "shorts_reels" ADD COLUMN "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "shorts_reels" ADD COLUMN "costLog" JSONB NOT NULL DEFAULT '[]';
