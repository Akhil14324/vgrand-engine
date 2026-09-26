-- AlterTable
ALTER TABLE "CampaignResult" ADD COLUMN "label" TEXT;

-- CreateTable
CREATE TABLE "StrategyRevision" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "proposedPlan" JSONB NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "changes" JSONB NOT NULL,
    "focus" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLearning" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "nextStep" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignLearning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionDecision" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "deferUntil" TIMESTAMP(3),
    "note" TEXT,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SuggestionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategyRevision_strategyId_status_idx" ON "StrategyRevision"("strategyId", "status");
CREATE UNIQUE INDEX "CampaignLearning_strategyId_key" ON "CampaignLearning"("strategyId");
CREATE INDEX "CampaignLearning_brandId_updatedAt_idx" ON "CampaignLearning"("brandId", "updatedAt" DESC);
CREATE UNIQUE INDEX "SuggestionDecision_brandId_key_key" ON "SuggestionDecision"("brandId", "key");

-- AddForeignKey
ALTER TABLE "StrategyRevision" ADD CONSTRAINT "StrategyRevision_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignLearning" ADD CONSTRAINT "CampaignLearning_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignLearning" ADD CONSTRAINT "CampaignLearning_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SuggestionDecision" ADD CONSTRAINT "SuggestionDecision_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
