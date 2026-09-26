-- CreateTable
CREATE TABLE "GuavaProfile" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "industry" TEXT,
    "values" JSONB NOT NULL DEFAULT '{}',
    "skipped" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuavaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuavaDiagnosis" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "industry" TEXT,
    "completenessPct" INTEGER NOT NULL DEFAULT 0,
    "profileSnapshot" JSONB NOT NULL DEFAULT '{}',
    "platformSnapshot" JSONB,
    "report" JSONB,
    "comparison" JSONB,
    "previousId" TEXT,
    "model" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GuavaDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuavaMessage" (
    "id" TEXT NOT NULL,
    "diagnosisId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuavaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuavaProfile_brandId_key" ON "GuavaProfile"("brandId");

-- CreateIndex
CREATE INDEX "GuavaDiagnosis_brandId_createdAt_idx" ON "GuavaDiagnosis"("brandId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "GuavaMessage_diagnosisId_createdAt_idx" ON "GuavaMessage"("diagnosisId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuavaProfile" ADD CONSTRAINT "GuavaProfile_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuavaDiagnosis" ADD CONSTRAINT "GuavaDiagnosis_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuavaMessage" ADD CONSTRAINT "GuavaMessage_diagnosisId_fkey" FOREIGN KEY ("diagnosisId") REFERENCES "GuavaDiagnosis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
