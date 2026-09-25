-- Restore the HNSW index dropped by 20260925193631_growth_suite. Prisma cannot
-- see manual pgvector indexes on Unsupported("vector") columns, so it emits a
-- DROP INDEX on every migrate even though documents_rag intentionally created it.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
