import type { SocialPlatform } from "@catgpt/types";
import { facebookAdapter } from "./facebook.js";
import { instagramAdapter } from "./instagram.js";
import type { SocialAdapter } from "./types.js";
import { xAdapter } from "./x.js";
import { youtubeAdapter } from "./youtube.js";

const ADAPTERS: Record<SocialPlatform, SocialAdapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  x: xAdapter,
  youtube: youtubeAdapter,
};

export const getAdapter = (platform: SocialPlatform): SocialAdapter => ADAPTERS[platform];
export type { PreparedMedia, ProviderState, PublishInput, PublishResult, SocialAdapter } from "./types.js";
