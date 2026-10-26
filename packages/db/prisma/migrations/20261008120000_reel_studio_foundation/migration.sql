-- CreateTable
CREATE TABLE "SourceFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAsset" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "errorMessage" TEXT,
    "outputUrl" TEXT,
    "estimatedCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "costMicroUsd" INTEGER NOT NULL,
    "seconds" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceFolder_userId_idx" ON "SourceFolder"("userId");

-- CreateIndex
CREATE INDEX "SourceFolder_brandId_idx" ON "SourceFolder"("brandId");

-- CreateIndex
CREATE INDEX "SourceAsset_folderId_idx" ON "SourceAsset"("folderId");

-- CreateIndex
CREATE INDEX "VideoProject_userId_createdAt_idx" ON "VideoProject"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoProject_brandId_idx" ON "VideoProject"("brandId");

-- CreateIndex
CREATE INDEX "VideoUsage_userId_createdAt_idx" ON "VideoUsage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SourceFolder" ADD CONSTRAINT "SourceFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFolder" ADD CONSTRAINT "SourceFolder_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAsset" ADD CONSTRAINT "SourceAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "SourceFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "SourceFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoUsage" ADD CONSTRAINT "VideoUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
