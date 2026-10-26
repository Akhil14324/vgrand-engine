-- CreateTable
CREATE TABLE "ReelPlanItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "postAt" TIMESTAMP(3) NOT NULL,
    "accountIds" TEXT[],
    "caption" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "projectId" TEXT,
    "generationId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReelPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReelPlanItem_status_postAt_idx" ON "ReelPlanItem"("status", "postAt");

-- CreateIndex
CREATE INDEX "ReelPlanItem_userId_postAt_idx" ON "ReelPlanItem"("userId", "postAt");

-- CreateIndex
CREATE INDEX "ReelPlanItem_brandId_idx" ON "ReelPlanItem"("brandId");

-- AddForeignKey
ALTER TABLE "ReelPlanItem" ADD CONSTRAINT "ReelPlanItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelPlanItem" ADD CONSTRAINT "ReelPlanItem_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
