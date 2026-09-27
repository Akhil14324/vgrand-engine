-- Replace SocialPost.mediaUrl (single image) with mediaUrls (ordered array),
-- so a post can carry a carousel of up to 10 images. Existing rows keep their
-- one image as a single-element array.
ALTER TABLE "SocialPost" ADD COLUMN "mediaUrls" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "SocialPost" SET "mediaUrls" = ARRAY["mediaUrl"] WHERE "mediaUrl" IS NOT NULL;

ALTER TABLE "SocialPost" ALTER COLUMN "mediaUrls" DROP DEFAULT;

ALTER TABLE "SocialPost" DROP COLUMN "mediaUrl";
