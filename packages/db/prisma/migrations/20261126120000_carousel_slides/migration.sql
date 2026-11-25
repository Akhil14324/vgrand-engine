-- AI carousel generator: a planned carousel plus one row per slide.
-- Additive only: two new tables, no changes to existing tables.

-- CreateTable
CREATE TABLE "Carousel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "brandId" TEXT,
    "themeId" TEXT,
    "prompt" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "aspect" TEXT NOT NULL DEFAULT 'square',
    "quality" TEXT NOT NULL DEFAULT 'low',
    "design" JSONB,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "error" TEXT,
    "requestKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carousel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarouselSlide" (
    "id" TEXT NOT NULL,
    "carouselId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'content',
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "visual" TEXT NOT NULL DEFAULT '',
    "productLabel" TEXT,
    "imageUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "generationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarouselSlide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Carousel_generationId_key" ON "Carousel"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "Carousel_userId_requestKey_key" ON "Carousel"("userId", "requestKey");

-- CreateIndex
CREATE INDEX "Carousel_userId_createdAt_idx" ON "Carousel"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CarouselSlide_carouselId_position_idx" ON "CarouselSlide"("carouselId", "position");

-- CreateIndex
CREATE INDEX "CarouselSlide_generationId_idx" ON "CarouselSlide"("generationId");

-- AddForeignKey
ALTER TABLE "Carousel" ADD CONSTRAINT "Carousel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carousel" ADD CONSTRAINT "Carousel_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarouselSlide" ADD CONSTRAINT "CarouselSlide_carouselId_fkey" FOREIGN KEY ("carouselId") REFERENCES "Carousel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
