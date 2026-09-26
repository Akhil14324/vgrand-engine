-- CreateTable
CREATE TABLE "BrandGuidelines" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandGuidelines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandGuidelines_brandId_key" ON "BrandGuidelines"("brandId");

-- AddForeignKey
ALTER TABLE "BrandGuidelines" ADD CONSTRAINT "BrandGuidelines_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
