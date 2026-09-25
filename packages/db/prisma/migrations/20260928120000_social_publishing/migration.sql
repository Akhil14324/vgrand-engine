-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "platform" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "handle" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialOAuthSession" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "platform" TEXT NOT NULL,
    "codeVerifierEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialOAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "generationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "providerState" JSONB,
    "failureCode" TEXT,
    "remoteId" TEXT,
    "remoteUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_userId_idx" ON "SocialAccount"("userId");

-- CreateIndex
CREATE INDEX "SocialAccount_workspaceId_idx" ON "SocialAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_workspaceId_userId_platform_externalAccountId_key" ON "SocialAccount"("workspaceId", "userId", "platform", "externalAccountId");

-- Personal scope (workspaceId IS NULL): NULLs are distinct in a plain unique
-- index, so this partial index is what actually dedupes personal accounts.
CREATE UNIQUE INDEX "SocialAccount_personal_unique" ON "SocialAccount"("userId", "platform", "externalAccountId") WHERE "workspaceId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SocialOAuthSession_stateHash_key" ON "SocialOAuthSession"("stateHash");

-- CreateIndex
CREATE INDEX "SocialOAuthSession_expiresAt_idx" ON "SocialOAuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SocialPost_generationId_idx" ON "SocialPost"("generationId");

-- CreateIndex
CREATE INDEX "SocialPost_userId_createdAt_idx" ON "SocialPost"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
