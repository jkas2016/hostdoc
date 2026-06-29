import { resolveConfig, type Overrides } from "../lib/config.js";
import { buildPublicUrl } from "../lib/url.js";
import { openInBrowser } from "../lib/browser.js";
import { isValidPath, isValidCode } from "../lib/code.js";

export function resolveOpenUrl(
  args: { id: string } & Overrides,
): string {
  if (!isValidPath(args.id) && !isValidCode(args.id)) {
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

/** Open a just-published URL: derive its (possibly nested) path and re-open under `overrides`. */
export function openPublishedUrl(url: string, overrides: Overrides = {}): string {
  const id = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  return runOpen({ id, ...overrides });
}
