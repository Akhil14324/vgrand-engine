-- Cached condensed notes for long-document summaries (skips the map step on repeat asks).
ALTER TABLE "Document" ADD COLUMN "summaryNotes" TEXT;
