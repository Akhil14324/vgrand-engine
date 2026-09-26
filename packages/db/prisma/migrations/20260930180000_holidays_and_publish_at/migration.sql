-- AlterTable
ALTER TABLE "CampaignPost" ADD COLUMN "publishAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "region" TEXT,
    "type" TEXT NOT NULL DEFAULT 'observance',
    "source" TEXT NOT NULL DEFAULT 'curated',

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_name_country_key" ON "Holiday"("date", "name", "country");
