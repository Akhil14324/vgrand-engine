-- CreateTable
CREATE TABLE "WhatsappNumber" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "displayPhone" TEXT,
    "verifiedName" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "botMode" TEXT NOT NULL DEFAULT 'hybrid',
    "greeting" TEXT NOT NULL DEFAULT '',
    "aiInstructions" TEXT NOT NULL DEFAULT '',
    "menu" JSONB NOT NULL DEFAULT '[]',
    "handoffKeywords" TEXT[],
    "handoffMessage" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappContact" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "name" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'lead',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "tags" TEXT[],
    "fields" JSONB NOT NULL DEFAULT '{}',
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "optInSource" TEXT,
    "optedOutAt" TIMESTAMP(3),
    "botPaused" BOOLEAN NOT NULL DEFAULT false,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "waMessageId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "mediaUrl" TEXT,
    "templateName" TEXT,
    "replyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "headerType" TEXT,
    "headerUrl" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "examples" TEXT[],
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "metaId" TEXT,
    "metaStatus" TEXT NOT NULL DEFAULT 'draft',
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappBroadcast" (
    "id" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" JSONB NOT NULL DEFAULT '{}',
    "variableMap" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappBroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "waMessageId" TEXT,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappBroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappNumber_phoneNumberId_key" ON "WhatsappNumber"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsappNumber_brandId_idx" ON "WhatsappNumber"("brandId");

-- CreateIndex
CREATE INDEX "WhatsappContact_numberId_lastMessageAt_idx" ON "WhatsappContact"("numberId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "WhatsappContact_numberId_stage_idx" ON "WhatsappContact"("numberId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappContact_numberId_waId_key" ON "WhatsappContact"("numberId", "waId");

-- CreateIndex
CREATE INDEX "WhatsappMessage_contactId_createdAt_idx" ON "WhatsappMessage"("contactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_numberId_waMessageId_key" ON "WhatsappMessage"("numberId", "waMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_numberId_name_language_key" ON "WhatsappTemplate"("numberId", "name", "language");

-- CreateIndex
CREATE INDEX "WhatsappBroadcast_numberId_createdAt_idx" ON "WhatsappBroadcast"("numberId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappBroadcastRecipient_broadcastId_status_idx" ON "WhatsappBroadcastRecipient"("broadcastId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappBroadcastRecipient_broadcastId_contactId_key" ON "WhatsappBroadcastRecipient"("broadcastId", "contactId");

-- AddForeignKey
ALTER TABLE "WhatsappNumber" ADD CONSTRAINT "WhatsappNumber_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappContact" ADD CONSTRAINT "WhatsappContact_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsappContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappTemplate" ADD CONSTRAINT "WhatsappTemplate_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappBroadcast" ADD CONSTRAINT "WhatsappBroadcast_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "WhatsappNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappBroadcast" ADD CONSTRAINT "WhatsappBroadcast_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WhatsappTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappBroadcastRecipient" ADD CONSTRAINT "WhatsappBroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "WhatsappBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappBroadcastRecipient" ADD CONSTRAINT "WhatsappBroadcastRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsappContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

