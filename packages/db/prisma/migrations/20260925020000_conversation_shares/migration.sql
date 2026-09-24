-- Shareable read-only chat links. Idempotent, additive.
CREATE TABLE IF NOT EXISTS "ConversationShare" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationShare_token_key" ON "ConversationShare"("token");
CREATE INDEX IF NOT EXISTS "ConversationShare_conversationId_idx" ON "ConversationShare"("conversationId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationShare_conversationId_fkey') THEN
    ALTER TABLE "ConversationShare" ADD CONSTRAINT "ConversationShare_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
