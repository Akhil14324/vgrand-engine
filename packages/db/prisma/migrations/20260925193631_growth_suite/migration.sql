-- DropIndex
DROP INDEX IF EXISTS "DocumentChunk_embedding_hnsw_idx";

-- CreateTable
CREATE TABLE IF NOT EXISTS "BrandMascot" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandMascot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ApprovalLink" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewerName" TEXT,
    "reviewerEmail" TEXT,
    "comment" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CampaignPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "conversationId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CampaignPost" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "generationId" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "platform" TEXT,
    "prompt" TEXT NOT NULL,
    "caption" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "error" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BrandMascot_brandId_key" ON "BrandMascot"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BrandMascot_assetId_key" ON "BrandMascot"("assetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BrandMascot_brandId_idx" ON "BrandMascot"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalLink_token_key" ON "ApprovalLink"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalLink_generationId_idx" ON "ApprovalLink"("generationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CampaignPlan_userId_createdAt_idx" ON "CampaignPlan"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CampaignPlan_brandId_idx" ON "CampaignPlan"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignPost_generationId_key" ON "CampaignPost"("generationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CampaignPost_planId_scheduledFor_idx" ON "CampaignPost"("planId", "scheduledFor");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CampaignPost_status_scheduledFor_idx" ON "CampaignPost"("status", "scheduledFor");

-- AddForeignKey (idempotent so a manually applied copy can be marked applied)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrandMascot_brandId_fkey') THEN
    ALTER TABLE "BrandMascot" ADD CONSTRAINT "BrandMascot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrandMascot_assetId_fkey') THEN
    ALTER TABLE "BrandMascot" ADD CONSTRAINT "BrandMascot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "BrandAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApprovalLink_generationId_fkey') THEN
    ALTER TABLE "ApprovalLink" ADD CONSTRAINT "ApprovalLink_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignPlan_userId_fkey') THEN
    ALTER TABLE "CampaignPlan" ADD CONSTRAINT "CampaignPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignPlan_brandId_fkey') THEN
    ALTER TABLE "CampaignPlan" ADD CONSTRAINT "CampaignPlan_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignPlan_conversationId_fkey') THEN
    ALTER TABLE "CampaignPlan" ADD CONSTRAINT "CampaignPlan_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignPost_planId_fkey') THEN
    ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CampaignPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignPost_generationId_fkey') THEN
    ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
