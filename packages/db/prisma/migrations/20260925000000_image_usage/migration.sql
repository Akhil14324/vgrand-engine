-- Permanent ledger of image generations, used for the per-user daily quota.
-- Deliberately has no FK to Generation: deleting a chat must not refund quota.
CREATE TABLE IF NOT EXISTS "ImageUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ImageUsage_userId_createdAt_idx" ON "ImageUsage"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ImageUsage_generationId_idx" ON "ImageUsage"("generationId");

-- Backfill from today's existing image generations so current usage carries over.
INSERT INTO "ImageUsage" ("id", "userId", "generationId", "createdAt")
SELECT gen_random_uuid()::text, g."userId", g."id", g."createdAt"
FROM "Generation" g
WHERE g."kind" = 'image' AND g."status" <> 'failed'
  AND g."createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC')
  AND NOT EXISTS (SELECT 1 FROM "ImageUsage" u WHERE u."generationId" = g."id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImageUsage_userId_fkey') THEN
    ALTER TABLE "ImageUsage" ADD CONSTRAINT "ImageUsage_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
