import { resolveConfig, type Overrides } from "../lib/config.js";
import { buildPublicUrl } from "../lib/url.js";
import { openInBrowser } from "../lib/browser.js";
import { isValidSlug } from "../lib/code.js";

export function resolveOpenUrl(
  args: { id: string } & Overrides,
): string {
  if (!isValidSlug(args.id)) {
    throw new Error(`Invalid id: ${args.id}`);
  }
  const cfg = resolveConfig(args);
  return buildPublicUrl(cfg, args.id);
}

export function runOpen(args: { id: string } & Overrides): string {
  const url = resolveOpenUrl(args);
  openInBrowser(url);
  return url;
}
