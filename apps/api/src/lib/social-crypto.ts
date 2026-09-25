import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";

/**
 * AES-256-GCM for social provider tokens. Stored as base64("iv.tag.ciphertext"),
 * each part base64 too. The key (SOCIAL_TOKEN_KEY, 64 hex chars) never leaves
 * the server and is never logged; error messages here carry no key or token bytes.
 */
const IV_BYTES = 12;

function getKey(): Buffer {
  const hex = env.SOCIAL_TOKEN_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "SOCIAL_TOKEN_KEY must be set to 64 hex characters (openssl rand -hex 32)",
    );
  }
  return Buffer.from(hex, "hex");
}

/** True when SOCIAL_TOKEN_KEY is a usable key - lets routes fail early and clearly. */
export function hasValidTokenKey(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const parts = [iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
  return Buffer.from(parts, "utf8").toString("base64");
}

export function decryptToken(encoded: string): string {
  const key = getKey();
  const parts = Buffer.from(encoded, "base64").toString("utf8").split(".");
  if (parts.length !== 3) throw new Error("Stored token is malformed");
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64")) as [
    Buffer,
    Buffer,
    Buffer,
  ];
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered data - say so without echoing anything sensitive.
    throw new Error("Stored token could not be decrypted (wrong SOCIAL_TOKEN_KEY?)");
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
