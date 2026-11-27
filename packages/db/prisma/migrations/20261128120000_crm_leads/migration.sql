-- CreateTable
CREATE TABLE "CrmLead" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "igUserId" TEXT,
    "igUsername" TEXT,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "ownerId" TEXT,
    "followUpOn" DATE,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmInstagramRoute" (
    "accountId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmInstagramRoute_pkey" PRIMARY KEY ("accountId")
);

-- CreateIndex
CREATE INDEX "CrmLead_brandId_lastActivityAt_idx" ON "CrmLead"("brandId", "lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "CrmLead_brandId_stage_idx" ON "CrmLead"("brandId", "stage");

-- CreateIndex
CREATE INDEX "CrmLead_brandId_followUpOn_idx" ON "CrmLead"("brandId", "followUpOn");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLead_brandId_phone_key" ON "CrmLead"("brandId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CrmLead_brandId_igUserId_key" ON "CrmLead"("brandId", "igUserId");

-- CreateIndex
CREATE INDEX "CrmActivity_leadId_createdAt_idx" ON "CrmActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmInstagramRoute_brandId_idx" ON "CrmInstagramRoute"("brandId");

-- AddForeignKey
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CrmLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmInstagramRoute" ADD CONSTRAINT "CrmInstagramRoute_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmInstagramRoute" ADD CONSTRAINT "CrmInstagramRoute_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: existing WhatsApp leads (not imported buyers) become CRM leads, one per
-- brand and phone. If a person chatted with two numbers of a brand, the latest chat wins.
INSERT INTO "CrmLead" ("id", "brandId", "name", "phone", "source", "stage", "fields", "lastActivityAt", "createdAt", "updatedAt")
SELECT DISTINCT ON (n."brandId", c."waId")
    gen_random_uuid()::text,
    n."brandId",
    NULLIF(c."name", ''),
    c."waId",
    CASE WHEN c."lastInboundAt" IS NULL THEN 'import' ELSE 'whatsapp' END,
    c."stage",
    c."fields",
    COALESCE(c."lastMessageAt", c."createdAt"),
    c."createdAt",
    CURRENT_TIMESTAMP
FROM "WhatsappContact" c
JOIN "WhatsappNumber" n ON n."id" = c."numberId"
WHERE c."kind" = 'lead'
ORDER BY n."brandId", c."waId", c."lastMessageAt" DESC NULLS LAST
ON CONFLICT DO NOTHING;
