-- AlterTable
ALTER TABLE "IgAutomationRule" ADD COLUMN "dmOptions" JSONB;

-- AlterTable
ALTER TABLE "IgAutomationEvent" ADD COLUMN "payload" TEXT;
