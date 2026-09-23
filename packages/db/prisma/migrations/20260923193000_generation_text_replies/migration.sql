-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'image',
ADD COLUMN     "textResponse" TEXT;
