-- CreateTable
CREATE TABLE "GuavaContentAudit" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "handle" TEXT,
    "competitors" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'processing',
    "progress" TEXT,
    "accounts" JSONB,
    "reels" JSONB,
    "skipped" JSONB,
    "split" JSONB,
    "report" JSONB,
    "model" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GuavaContentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuavaContentAudit_brandId_createdAt_idx" ON "GuavaContentAudit"("brandId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "GuavaContentAudit" ADD CONSTRAINT "GuavaContentAudit_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "InstagramSetup" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "accountId" TEXT,
    "competitors" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramSetup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramSetup_scopeKey_key" ON "InstagramSetup"("scopeKey");
