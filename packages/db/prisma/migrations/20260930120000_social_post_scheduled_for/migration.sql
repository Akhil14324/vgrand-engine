-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SocialPost_status_scheduledFor_idx" ON "SocialPost"("status", "scheduledFor");
