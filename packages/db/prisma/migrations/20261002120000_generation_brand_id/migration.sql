-- Generation.brandId mirrors metadata.brandId so per-brand reports don't filter JSON.
ALTER TABLE "Generation" ADD COLUMN "brandId" TEXT;

-- Backfill from metadata (only brands that still exist, so the FK below holds).
UPDATE "Generation" g
SET "brandId" = g."metadata"->>'brandId'
WHERE g."metadata"->>'brandId' IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Brand" b WHERE b."id" = g."metadata"->>'brandId');

CREATE INDEX "Generation_brandId_createdAt_idx" ON "Generation"("brandId", "createdAt" DESC);

ALTER TABLE "Generation"
  ADD CONSTRAINT "Generation_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
