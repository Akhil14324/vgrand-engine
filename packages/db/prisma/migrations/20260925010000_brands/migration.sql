-- Brand module: guided brand profile + assets + documents. Idempotent, additive.

CREATE TABLE IF NOT EXISTS "Brand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BrandAsset" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "brandId" TEXT;

CREATE INDEX IF NOT EXISTS "Brand_userId_idx" ON "Brand"("userId");
CREATE INDEX IF NOT EXISTS "Brand_workspaceId_idx" ON "Brand"("workspaceId");
CREATE INDEX IF NOT EXISTS "BrandAsset_brandId_idx" ON "BrandAsset"("brandId");
CREATE INDEX IF NOT EXISTS "Document_brandId_idx" ON "Document"("brandId");

-- One personal brand per user (workspace brands are unlimited). Prisma cannot
-- express a partial unique index, so it lives only in SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "Brand_one_personal_per_user"
    ON "Brand"("userId") WHERE "workspaceId" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Brand_userId_fkey') THEN
    ALTER TABLE "Brand" ADD CONSTRAINT "Brand_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Brand_workspaceId_fkey') THEN
    ALTER TABLE "Brand" ADD CONSTRAINT "Brand_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BrandAsset_brandId_fkey') THEN
    ALTER TABLE "BrandAsset" ADD CONSTRAINT "BrandAsset_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_brandId_fkey') THEN
    ALTER TABLE "Document" ADD CONSTRAINT "Document_brandId_fkey"
      FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
