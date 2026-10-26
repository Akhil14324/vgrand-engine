-- CreateTable
CREATE TABLE "VideoSettings" (
    "userId" TEXT NOT NULL,
    "monthlyCapUsd" DOUBLE PRECISION,
    "autopilotEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoSettings_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "VideoSettings" ADD CONSTRAINT "VideoSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
