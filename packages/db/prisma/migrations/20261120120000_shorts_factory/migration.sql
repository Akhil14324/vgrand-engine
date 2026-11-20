-- CreateTable
CREATE TABLE "shorts_channels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fallbackPath" TEXT,
    "videosPerDay" INTEGER NOT NULL DEFAULT 1,
    "postingTimes" TEXT[],
    "approvalMode" TEXT NOT NULL DEFAULT 'manual',
    "voiceId" TEXT,
    "styleNotes" JSONB NOT NULL DEFAULT '{}',
    "stockKeywords" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ytChannelId" TEXT,
    "ytChannelTitle" TEXT,
    "ytAccessTokenEnc" TEXT,
    "ytRefreshTokenEnc" TEXT,
    "ytTokenExpiresAt" TIMESTAMP(3),
    "ytStatus" TEXT NOT NULL DEFAULT 'disconnected',
    "ytStatusReason" TEXT,
    "ytConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shorts_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_videos" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "path" TEXT NOT NULL,
    "plannedPath" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'scheduler',
    "slotAt" TIMESTAMP(3),
    "title" TEXT,
    "description" TEXT,
    "tags" TEXT[],
    "hook" TEXT,
    "hookType" TEXT,
    "topic" TEXT,
    "narration" TEXT,
    "beats" JSONB,
    "scriptHash" TEXT,
    "footageHash" TEXT,
    "llmPrompt" JSONB,
    "llmResponse" JSONB,
    "voiceId" TEXT,
    "wordTimings" JSONB,
    "musicTrack" TEXT,
    "filePath" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fileSizeBytes" INTEGER,
    "validation" JSONB,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "dims" JSONB NOT NULL DEFAULT '{}',
    "youtubeVideoId" TEXT,
    "youtubeUrl" TEXT,
    "publishAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "privacyStatus" TEXT,
    "privateLocked" BOOLEAN NOT NULL DEFAULT false,
    "manualReason" TEXT,
    "uploadState" JSONB,
    "error" TEXT,
    "manualViewedPct" DOUBLE PRECISION,
    "ingestKey" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shorts_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_assets" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAssetId" TEXT,
    "sourceUrl" TEXT,
    "downloadUrl" TEXT,
    "license" TEXT NOT NULL,
    "licenseUrl" TEXT,
    "author" TEXT,
    "authorUrl" TEXT,
    "beatIndex" INTEGER,
    "localPath" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shorts_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_costs" (
    "id" TEXT NOT NULL,
    "videoId" TEXT,
    "channelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shorts_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_metric_snapshots" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "engagedViews" INTEGER,
    "estimatedMinutesWatched" DOUBLE PRECISION,
    "averageViewDuration" DOUBLE PRECISION,
    "averageViewPercentage" DOUBLE PRECISION,
    "subscribersGained" INTEGER,
    "raw" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shorts_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "videoId" TEXT,
    "channelId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shorts_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_events" (
    "id" TEXT NOT NULL,
    "videoId" TEXT,
    "channelId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shorts_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_quota_days" (
    "day" TEXT NOT NULL,
    "uploads" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shorts_quota_days_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "shorts_settings" (
    "userId" TEXT NOT NULL,
    "pathCPricePerSecond" DOUBLE PRECISION,
    "pathCModel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shorts_settings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "shorts_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "prompt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shorts_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shorts_channels_userId_slug_key" ON "shorts_channels"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "shorts_videos_ingestKey_key" ON "shorts_videos"("ingestKey");

-- CreateIndex
CREATE INDEX "shorts_videos_status_idx" ON "shorts_videos"("status");

-- CreateIndex
CREATE INDEX "shorts_videos_channelId_createdAt_idx" ON "shorts_videos"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "shorts_videos_channelId_scriptHash_idx" ON "shorts_videos"("channelId", "scriptHash");

-- CreateIndex
CREATE INDEX "shorts_videos_userId_createdAt_idx" ON "shorts_videos"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shorts_videos_channelId_slotAt_key" ON "shorts_videos"("channelId", "slotAt");

-- CreateIndex
CREATE INDEX "shorts_assets_videoId_idx" ON "shorts_assets"("videoId");

-- CreateIndex
CREATE INDEX "shorts_assets_provider_providerAssetId_idx" ON "shorts_assets"("provider", "providerAssetId");

-- CreateIndex
CREATE INDEX "shorts_costs_channelId_createdAt_idx" ON "shorts_costs"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "shorts_costs_createdAt_idx" ON "shorts_costs"("createdAt");

-- CreateIndex
CREATE INDEX "shorts_metric_snapshots_videoId_capturedAt_idx" ON "shorts_metric_snapshots"("videoId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shorts_jobs_idempotencyKey_key" ON "shorts_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "shorts_jobs_status_runAt_idx" ON "shorts_jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "shorts_jobs_videoId_idx" ON "shorts_jobs"("videoId");

-- CreateIndex
CREATE INDEX "shorts_events_videoId_createdAt_idx" ON "shorts_events"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "shorts_events_channelId_createdAt_idx" ON "shorts_events"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "shorts_events_type_createdAt_idx" ON "shorts_events"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shorts_reports_userId_weekStart_key" ON "shorts_reports"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "shorts_channels" ADD CONSTRAINT "shorts_channels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_videos" ADD CONSTRAINT "shorts_videos_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "shorts_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_assets" ADD CONSTRAINT "shorts_assets_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "shorts_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_costs" ADD CONSTRAINT "shorts_costs_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "shorts_videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_metric_snapshots" ADD CONSTRAINT "shorts_metric_snapshots_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "shorts_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_settings" ADD CONSTRAINT "shorts_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_reports" ADD CONSTRAINT "shorts_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

