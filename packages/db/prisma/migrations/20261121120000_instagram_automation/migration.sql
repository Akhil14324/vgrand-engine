-- CreateTable
CREATE TABLE "IgAutomationRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL DEFAULT 'comment',
    "matchMode" TEXT NOT NULL DEFAULT 'keywords',
    "keywords" TEXT[],
    "mediaScope" TEXT NOT NULL DEFAULT 'all',
    "mediaIds" TEXT[],
    "publicReplies" TEXT[],
    "dmText" TEXT,
    "dmButtonTitle" TEXT,
    "dmButtonUrl" TEXT,
    "oncePerUser" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgAutomationEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ruleId" TEXT,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "mediaId" TEXT,
    "parentCommentId" TEXT,
    "fromId" TEXT,
    "fromUsername" TEXT,
    "text" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "publicReplyStatus" TEXT,
    "publicReplyText" TEXT,
    "publicReplyId" TEXT,
    "dmStatus" TEXT,
    "dmText" TEXT,
    "dmMessageId" TEXT,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgAutomationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IgAutomationRule_accountId_trigger_active_idx" ON "IgAutomationRule"("accountId", "trigger", "active");

-- CreateIndex
CREATE INDEX "IgAutomationEvent_accountId_createdAt_idx" ON "IgAutomationEvent"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "IgAutomationEvent_ruleId_createdAt_idx" ON "IgAutomationEvent"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "IgAutomationEvent_ruleId_fromId_idx" ON "IgAutomationEvent"("ruleId", "fromId");

-- CreateIndex
CREATE UNIQUE INDEX "IgAutomationEvent_accountId_kind_sourceId_key" ON "IgAutomationEvent"("accountId", "kind", "sourceId");

-- AddForeignKey
ALTER TABLE "IgAutomationRule" ADD CONSTRAINT "IgAutomationRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgAutomationEvent" ADD CONSTRAINT "IgAutomationEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgAutomationEvent" ADD CONSTRAINT "IgAutomationEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "IgAutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

