-- Restore the HNSW index dropped by 20260925190536_allow_multiple_personal_brands,
-- which Prisma generated only because it can't see manual indexes in schema.prisma.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx" ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
