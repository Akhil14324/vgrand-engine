-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'goal',
    "sourceRef" JSONB,
    "sourceText" TEXT,
    "plan" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "convertedAt" TIMESTAMP(3),
    "review" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyMessage" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT,
    "format" TEXT,
    "brief" TEXT NOT NULL DEFAULT '',
    "source" JSONB NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "dueAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "generationId" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "completionNote" TEXT,
    "externalUrl" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "blockedReason" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecTask" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "dependsOnId" TEXT,
    "source" JSONB NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "blockedReason" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExecTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecEvent" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "taskId" TEXT,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignResult" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "deliverableId" TEXT,
    "channel" TEXT,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "sourceNote" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "enteredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Strategy_brandId_status_idx" ON "Strategy"("brandId", "status");
CREATE UNIQUE INDEX "StrategyVersion_strategyId_version_key" ON "StrategyVersion"("strategyId", "version");
CREATE INDEX "StrategyMessage_strategyId_createdAt_idx" ON "StrategyMessage"("strategyId", "createdAt");
CREATE UNIQUE INDEX "Deliverable_strategyId_dedupeKey_key" ON "Deliverable"("strategyId", "dedupeKey");
CREATE INDEX "Deliverable_brandId_status_idx" ON "Deliverable"("brandId", "status");
CREATE INDEX "Deliverable_generationId_idx" ON "Deliverable"("generationId");
CREATE UNIQUE INDEX "ExecTask_strategyId_dedupeKey_key" ON "ExecTask"("strategyId", "dedupeKey");
CREATE INDEX "ExecTask_brandId_status_idx" ON "ExecTask"("brandId", "status");
CREATE INDEX "ExecTask_assigneeId_idx" ON "ExecTask"("assigneeId");
CREATE INDEX "ExecEvent_strategyId_createdAt_idx" ON "ExecEvent"("strategyId", "createdAt" DESC);
CREATE INDEX "ExecEvent_deliverableId_createdAt_idx" ON "ExecEvent"("deliverableId", "createdAt");
CREATE INDEX "ExecEvent_taskId_createdAt_idx" ON "ExecEvent"("taskId", "createdAt");
CREATE INDEX "CampaignResult_strategyId_periodEnd_idx" ON "CampaignResult"("strategyId", "periodEnd" DESC);

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategyVersion" ADD CONSTRAINT "StrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategyMessage" ADD CONSTRAINT "StrategyMessage_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecTask" ADD CONSTRAINT "ExecTask_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecTask" ADD CONSTRAINT "ExecTask_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExecEvent" ADD CONSTRAINT "ExecEvent_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecEvent" ADD CONSTRAINT "ExecEvent_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecEvent" ADD CONSTRAINT "ExecEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ExecTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignResult" ADD CONSTRAINT "CampaignResult_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignResult" ADD CONSTRAINT "CampaignResult_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
