-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "campaign" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: conversations that already contain a /campaign turn stay campaign
-- chats instead of silently flipping back to normal mode after the upgrade.
UPDATE "Conversation" c
SET "campaign" = true
WHERE EXISTS (
  SELECT 1 FROM "Generation" g
  WHERE g."conversationId" = c."id" AND g."prompt" LIKE '/campaign%'
);

-- Index for the vector column so passage retrieval stops being an exact scan.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw"
  ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
