-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "metadata" JSONB;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_sourceGenId_fkey" FOREIGN KEY ("sourceGenId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
