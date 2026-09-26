-- CreateTable
CREATE TABLE "ComplianceCheck" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT,
    "imageUrl" TEXT,
    "caption" TEXT,
    "status" TEXT NOT NULL,
    "ruleFindings" JSONB NOT NULL,
    "aiFindings" JSONB,
    "aiSkippedReason" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceCheck_brandId_createdAt_idx" ON "ComplianceCheck"("brandId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ComplianceCheck_generationId_idx" ON "ComplianceCheck"("generationId");

-- AddForeignKey
ALTER TABLE "ComplianceCheck" ADD CONSTRAINT "ComplianceCheck_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
