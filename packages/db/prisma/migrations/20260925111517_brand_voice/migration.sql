-- Brand voice: one privately saved, consented reference recording per brand.
-- Idempotent, additive. NOTE: Prisma drift detection tried to drop the
-- DocumentChunk_embedding_hnsw_idx index here — it is intentionally created by
-- documents_rag (Unsupported "vector" hides it from the schema). Kept.

CREATE TABLE IF NOT EXISTS "BrandVoice" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sampleLanguage" TEXT NOT NULL,
    "scriptText" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "attestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enrolling',
    "enrolledAt" TIMESTAMP(3),
    "lastSynthesisError" TEXT,
    "lastSynthesisErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandVoice_pkey" PRIMARY KEY ("id")
);

-- One voice row per brand.
CREATE UNIQUE INDEX IF NOT EXISTS "BrandVoice_brandId_key" ON "BrandVoice"("brandId");
CREATE INDEX IF NOT EXISTS "BrandVoice_attestedById_idx" ON "BrandVoice"("attestedById");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrandVoice_brandId_fkey') THEN
    ALTER TABLE "BrandVoice" ADD CONSTRAINT "BrandVoice_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrandVoice_attestedById_fkey') THEN
    ALTER TABLE "BrandVoice" ADD CONSTRAINT "BrandVoice_attestedById_fkey"
      FOREIGN KEY ("attestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
