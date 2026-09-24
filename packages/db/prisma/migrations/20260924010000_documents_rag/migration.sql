-- pgvector: embeddings for PDF RAG chunks. Supabase ships it; locally use the
-- pgvector/pgvector:pg16 image (see docker-compose.yml).
CREATE EXTENSION IF NOT EXISTS vector;

-- Idempotent: the prod DB may already have some of these objects (a db push
-- ran before migrations), so every statement converges instead of failing.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "filename" TEXT NOT NULL,
    "storageUrl" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- Converge columns in case a partially-different table was pushed earlier.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "storageUrl" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "pageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "chunkCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'processing';
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Document_userId_createdAt_idx" ON "Document"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Document_conversationId_idx" ON "Document"("conversationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- HNSW index for cosine-similarity retrieval (pgvector 0.5+)
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx" ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey (guarded — ADD CONSTRAINT has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_userId_fkey') THEN
    ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_conversationId_fkey') THEN
    ALTER TABLE "Document" ADD CONSTRAINT "Document_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DocumentChunk_documentId_fkey') THEN
    ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
