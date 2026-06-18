import { randomBytes } from "node:crypto";

const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Random base62 identifier. Default 7 chars ≈ 62^7 ≈ 3.5e12 possibilities. */
export function generateCode(len = 7): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % 62];
  return out;
}

/** Lowercase letters/digits/hyphen, must start alphanumeric, 1–63 chars. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}
