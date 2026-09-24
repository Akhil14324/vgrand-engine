-- Workspaces replace Library/boards: a named collection of documents + chats
-- whose contents ground every question asked inside it. Idempotent —
-- prod may be partially provisioned (see documents_rag for precedent).

-- CreateTable
CREATE TABLE IF NOT EXISTS "Workspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Workspace_userId_updatedAt_idx" ON "Workspace"("userId", "updatedAt" DESC);

-- Documents gain a durable workspace home (SetNull: deleting a workspace
-- detaches files instead of destroying user uploads).
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
CREATE INDEX IF NOT EXISTS "Document_workspaceId_idx" ON "Document"("workspaceId");

-- Conversations can live inside a workspace (SetNull: deleting a workspace
-- keeps the chats as normal conversations).
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_idx" ON "Conversation"("workspaceId");

-- AddForeignKey (guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Workspace_userId_fkey') THEN
    ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_workspaceId_fkey') THEN
    ALTER TABLE "Document" ADD CONSTRAINT "Document_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Conversation_workspaceId_fkey') THEN
    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Drop the boards feature being replaced (items first — FK order).
DROP TABLE IF EXISTS "BoardItem";
DROP TABLE IF EXISTS "Board";
