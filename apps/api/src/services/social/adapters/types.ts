import type { SocialAccount } from "@catgpt/db";
import type { SocialPlatform, SocialPostContent } from "@catgpt/types";
import type { DecryptedTokens } from "../tokens.js";

/** Resumable-operation bookkeeping persisted on SocialPost.providerState. */
export type ProviderState = Record<string, unknown>;

/**
 * Media is prepared OUTSIDE adapters (services/social/media). These lazy
 * loaders let an adapter ask only for what it needs - e.g. a YouTube retry that
 * finds its upload already complete never re-encodes the video.
 */
export interface PreparedMedia {
  /** The stored snapshot URL (SocialPost.mediaUrl). */
  imageUrl: string;
  /** Verified public HTTPS URL (Instagram). Throws INVALID_MEDIA when not public. */
  publicUrl(): Promise<string>;
  /** Downloaded image bytes (Facebook, X). */
  image(): Promise<{ buffer: Buffer; contentType: string }>;
  /** Image converted to an 8s 1080x1920 MP4 (YouTube). */
  video(): Promise<Buffer>;
}

export interface PublishInput {
  account: SocialAccount;
  decryptedTokens: DecryptedTokens;
  content: SocialPostContent;
  media: PreparedMedia;
  providerState: ProviderState;
  /**
   * Persist provider state NOW - call after each irreversible step (container
   * created, upload session opened, media uploaded) so a crash + retry resumes
   * instead of duplicating. Returns the merged state.
   */
  saveState(patch: ProviderState): Promise<ProviderState>;
}

export interface PublishResult {
  remoteId: string;
  remoteUrl: string | null;
  providerState?: ProviderState;
}

export interface SocialAdapter {
  platform: SocialPlatform;
  publish(input: PublishInput): Promise<PublishResult>;
}
