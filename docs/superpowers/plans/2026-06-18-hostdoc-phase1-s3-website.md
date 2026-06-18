# hostdoc Phase 1 (S3 Website Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `hostdoc` CLI that provisions a public S3 static-website bucket and publishes a local HTML file or folder to it, returning a short shareable URL.

**Architecture:** Node.js + TypeScript ESM CLI. Pure helper modules in `src/lib/` (code generation, mime, url, config, file walking, metadata, an S3 wrapper) are composed by thin command modules in `src/commands/` (`setup`, `publish`, `list`, `rm`, `open`, `config`). `src/index.ts` wires commands with commander. AWS access uses the SDK v3 default credential chain. This plan covers **Mode B (s3-website)** only; Mode A (CloudFront via Terraform) is a separate Phase 2 plan, but the `Config` type and URL builder already account for both modes so Phase 2 extends rather than rewrites.

**Tech Stack:** TypeScript (ESM, NodeNext), `@aws-sdk/client-s3`, `@aws-sdk/credential-providers`, `commander`, `mime-types`; tests with `vitest` + `aws-sdk-client-mock`.

**Spec:** `docs/superpowers/specs/2026-06-18-hostdoc-cli-design.md`

**Conventions for every task:**
- ESM with NodeNext: **relative imports use a `.js` extension** even though the source is `.ts` (e.g. `import { x } from "./code.js"`). Copy the import lines exactly as shown.
- Test files live in `test/` and import from `../src/...js`.
- Commands run from the repo root `/Users/yeonikjo/Documents/Workspace/publish-aws-s3`.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Project config, build, test runner |
| `src/lib/code.ts` | Random base62 code generation + slug validation |
| `src/lib/mime.ts` | Filename → Content-Type |
| `src/lib/url.ts` | S3 website endpoint + public URL builder (both modes) |
| `src/lib/config.ts` | `Config` type, config path, load/save/resolve with precedence |
| `src/lib/walk.ts` | Collect uploads from a file or directory |
| `src/lib/meta.ts` | `_meta/<code>.json` key, title extraction, metadata builder |
| `src/lib/aws.ts` | S3 client factory + put/list/delete/get helpers |
| `src/lib/browser.ts` | Open a URL in the OS browser |
| `src/commands/setup.ts` | Create the s3-website bucket + write config |
| `src/commands/publish.ts` | Upload a file/folder, write meta, print URL |
| `src/commands/list.ts` | List published docs from `_meta/` |
| `src/commands/rm.ts` | Delete a doc's objects + meta |
| `src/commands/open.ts` | Open a doc's URL |
| `src/commands/config.ts` | Print the active config |
| `src/index.ts` | commander wiring / dispatch |

---

## Task 0: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `test/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "hostdoc",
  "version": "0.1.0",
  "description": "Publish a local HTML file or folder to your own AWS and get a short shareable link.",
  "type": "module",
  "bin": { "hostdoc": "dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "node --import tsx src/index.ts"
  }
}
```

- [ ] **Step 2: Install dependencies** (versions resolved by npm — do not hand-pin)

Run:
```bash
npm install @aws-sdk/client-s3 @aws-sdk/credential-providers commander mime-types
npm install -D typescript tsx vitest aws-sdk-client-mock @types/node @types/mime-types
```
Expected: `node_modules/` created, deps added to `package.json`.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 5: Create `test/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the test suite**

Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold hostdoc TypeScript project"
```

---

## Task 1: `lib/code.ts` — code generation + slug validation

**Files:**
- Create: `src/lib/code.ts`
- Test: `test/code.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { generateCode, isValidSlug, SLUG_RE } from "../src/lib/code.js";

describe("generateCode", () => {
  it("returns 7 base62 chars by default", () => {
    const code = generateCode();
    expect(code).toMatch(/^[0-9A-Za-z]{7}$/);
  });
  it("honors a custom length", () => {
    expect(generateCode(10)).toHaveLength(10);
  });
  it("is non-deterministic across calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe("isValidSlug", () => {
  it.each(["a", "aws-design", "doc1", "a-b-c"])("accepts %s", (s) => {
    expect(isValidSlug(s)).toBe(true);
  });
  it.each(["", "-lead", "_meta", "UpperCase", "has space", "a/b", "x".repeat(64)])(
    "rejects %s",
    (s) => {
      expect(isValidSlug(s)).toBe(false);
    },
  );
  it("exposes the regex", () => {
    expect(SLUG_RE.test("ok-slug")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/code.test.ts`
Expected: FAIL — cannot find module `../src/lib/code.js`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/code.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/code.ts test/code.test.ts
git commit -m "feat: add code generation and slug validation"
```

---

## Task 2: `lib/mime.ts` — Content-Type lookup

**Files:**
- Create: `src/lib/mime.ts`
- Test: `test/mime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { contentTypeFor } from "../src/lib/mime.js";

describe("contentTypeFor", () => {
  it("maps html with charset", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
  });
  it("maps css and js and png", () => {
    expect(contentTypeFor("a.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("a.js")).toMatch(/javascript/);
    expect(contentTypeFor("a.png")).toBe("image/png");
  });
  it("falls back to octet-stream for unknown", () => {
    expect(contentTypeFor("file.unknownext")).toBe("application/octet-stream");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import mime from "mime-types";

/** Returns a Content-Type (with charset for text types) or octet-stream. */
export function contentTypeFor(filename: string): string {
  return mime.contentType(filename) || "application/octet-stream";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mime.ts test/mime.test.ts
git commit -m "feat: add content-type lookup"
```

---

## Task 3: `lib/url.ts` — website endpoint + public URL

**Files:**
- Create: `src/lib/url.ts`
- Test: `test/url.test.ts`

Reference: S3 website endpoint formats differ by region (dash vs dot). See https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteEndpoints.html

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { websiteEndpoint, buildPublicUrl } from "../src/lib/url.js";
import type { Config } from "../src/lib/config.js";

describe("websiteEndpoint", () => {
  it("uses dash style for classic regions", () => {
    expect(websiteEndpoint("b", "us-east-1")).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com",
    );
  });
  it("uses dot style for newer regions", () => {
    expect(websiteEndpoint("b", "ap-northeast-2")).toBe(
      "http://b.s3-website.ap-northeast-2.amazonaws.com",
    );
  });
});

describe("buildPublicUrl", () => {
  it("s3-website mode appends code with trailing slash", () => {
    const cfg: Config = {
      mode: "s3-website",
      bucket: "b",
      region: "us-east-1",
      websiteEndpoint: "http://b.s3-website-us-east-1.amazonaws.com",
    };
    expect(buildPublicUrl(cfg, "x7Kq2a")).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com/x7Kq2a/",
    );
  });
  it("cloudfront mode uses https domain", () => {
    const cfg: Config = {
      mode: "cloudfront",
      bucket: "b",
      region: "us-east-1",
      distributionId: "E123",
      domain: "shared.example.com",
    };
    expect(buildPublicUrl(cfg, "abc")).toBe("https://shared.example.com/abc/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/url.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { Config } from "./config.js";

// Regions that use the dash-style website endpoint (s3-website-<region>).
// All others use dot-style (s3-website.<region>). See AWS S3 Website Endpoints docs.
const DASH_REGIONS = new Set([
  "us-east-1",
  "us-west-1",
  "us-west-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "eu-west-1",
  "sa-east-1",
]);

export function websiteEndpoint(bucket: string, region: string): string {
  const host = DASH_REGIONS.has(region)
    ? `${bucket}.s3-website-${region}.amazonaws.com`
    : `${bucket}.s3-website.${region}.amazonaws.com`;
  return `http://${host}`;
}

export function buildPublicUrl(cfg: Config, code: string): string {
  if (cfg.mode === "cloudfront") {
    return `https://${cfg.domain}/${code}/`;
  }
  return `${cfg.websiteEndpoint}/${code}/`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/url.ts test/url.test.ts
git commit -m "feat: add website endpoint and public URL builder"
```

---

## Task 4: `lib/config.ts` — Config type + load/save/resolve

**Files:**
- Create: `src/lib/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPath,
  saveConfig,
  loadConfig,
  resolveConfig,
  type Config,
} from "../src/lib/config.js";

let dir: string;
const ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "HOSTDOC_BUCKET",
  "HOSTDOC_REGION",
  "HOSTDOC_DOMAIN",
  "HOSTDOC_DISTRIBUTION",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  dir = mkdtempSync(join(tmpdir(), "sf-"));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("configPath", () => {
  it("is under XDG_CONFIG_HOME/hostdoc", () => {
    expect(configPath()).toBe(join(dir, "hostdoc", "config.json"));
  });
});

describe("save/load", () => {
  it("round-trips a config", () => {
    const cfg: Config = {
      mode: "s3-website",
      bucket: "b",
      region: "us-east-1",
      websiteEndpoint: "http://b.s3-website-us-east-1.amazonaws.com",
    };
    saveConfig(cfg);
    expect(existsSync(configPath())).toBe(true);
    expect(loadConfig()).toEqual(cfg);
  });
  it("loadConfig returns null when absent", () => {
    expect(loadConfig()).toBeNull();
  });
});

describe("resolveConfig", () => {
  it("derives s3-website mode + endpoint from env bucket+region", () => {
    process.env.HOSTDOC_BUCKET = "envb";
    process.env.HOSTDOC_REGION = "us-east-1";
    const cfg = resolveConfig({});
    expect(cfg.mode).toBe("s3-website");
    expect(cfg.websiteEndpoint).toBe(
      "http://envb.s3-website-us-east-1.amazonaws.com",
    );
  });
  it("derives cloudfront mode from domain+distribution", () => {
    const cfg = resolveConfig({
      bucket: "b",
      region: "us-east-1",
      domain: "shared.example.com",
      distribution: "E1",
    });
    expect(cfg.mode).toBe("cloudfront");
    expect(cfg.domain).toBe("shared.example.com");
  });
  it("flags override the file", () => {
    saveConfig({
      mode: "s3-website",
      bucket: "fileb",
      region: "us-east-1",
      websiteEndpoint: "http://fileb.s3-website-us-east-1.amazonaws.com",
    });
    const cfg = resolveConfig({ bucket: "flagb" });
    expect(cfg.bucket).toBe("flagb");
  });
  it("throws a helpful error when nothing is configured", () => {
    expect(() => resolveConfig({})).toThrow(/hostdoc setup/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { websiteEndpoint } from "./url.js";

export type Mode = "s3-website" | "cloudfront";

export interface Config {
  mode: Mode;
  bucket: string;
  region: string;
  websiteEndpoint?: string; // s3-website
  distributionId?: string; // cloudfront
  domain?: string; // cloudfront
}

/** Per-field overrides accepted from CLI flags. */
export interface Overrides {
  bucket?: string;
  region?: string;
  domain?: string;
  distribution?: string;
}

export function configPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "hostdoc", "config.json");
}

export function saveConfig(cfg: Config): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

export function loadConfig(): Config | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Config;
}

/** Merge file < env < flags, then derive mode and required fields. */
export function resolveConfig(flags: Overrides): Config {
  const file = loadConfig();
  const bucket = flags.bucket ?? process.env.HOSTDOC_BUCKET ?? file?.bucket;
  const region = flags.region ?? process.env.HOSTDOC_REGION ?? file?.region;
  const domain = flags.domain ?? process.env.HOSTDOC_DOMAIN ?? file?.domain;
  const distributionId =
    flags.distribution ??
    process.env.HOSTDOC_DISTRIBUTION ??
    file?.distributionId;

  if (domain && distributionId) {
    if (!bucket || !region) {
      throw new Error(
        "Incomplete cloudfront config: bucket and region are required. Run `hostdoc init --from-terraform <dir>`.",
      );
    }
    return { mode: "cloudfront", bucket, region, domain, distributionId };
  }

  if (bucket && region) {
    return {
      mode: "s3-website",
      bucket,
      region,
      websiteEndpoint: file?.websiteEndpoint ?? websiteEndpoint(bucket, region),
    };
  }

  throw new Error(
    "No configuration found. Run `hostdoc setup` to create infrastructure, or set --bucket/--region (or HOSTDOC_BUCKET/HOSTDOC_REGION).",
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts test/config.test.ts
git commit -m "feat: add config load/save/resolve with precedence"
```

---

## Task 5: `lib/walk.ts` — collect uploads from a file or folder

**Files:**
- Create: `src/lib/walk.ts`
- Test: `test/walk.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectUploads } from "../src/lib/walk.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sf-walk-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("collectUploads", () => {
  it("maps a single file to index.html with its content-type", async () => {
    const f = join(dir, "report.html");
    writeFileSync(f, "<html></html>");
    const ups = await collectUploads(f);
    expect(ups).toHaveLength(1);
    expect(ups[0].key).toBe("index.html");
    expect(ups[0].contentType).toBe("text/html; charset=utf-8");
    expect(ups[0].size).toBeGreaterThan(0);
  });

  it("walks a folder recursively with posix keys", async () => {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.css"), "body{}");
    const ups = await collectUploads(dir);
    const keys = ups.map((u) => u.key).sort();
    expect(keys).toEqual(["assets/app.css", "index.html"]);
  });

  it("throws on a missing path", async () => {
    await expect(collectUploads(join(dir, "nope"))).rejects.toThrow(/not found/);
  });

  it("throws on an empty folder", async () => {
    const empty = join(dir, "empty");
    mkdirSync(empty);
    await expect(collectUploads(empty)).rejects.toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/walk.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { contentTypeFor } from "./mime.js";

export interface Upload {
  key: string; // relative key under <code>/, posix separators
  absPath: string;
  contentType: string;
  size: number;
}

async function walkDir(root: string, current: string, out: Upload[]) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(current, e.name);
    if (e.isDirectory()) {
      await walkDir(root, abs, out);
    } else if (e.isFile()) {
      const rel = relative(root, abs).split(sep).join("/");
      const s = await stat(abs);
      out.push({
        key: rel,
        absPath: abs,
        contentType: contentTypeFor(e.name),
        size: s.size,
      });
    }
  }
}

/** Single file → index.html; directory → recursive tree under the same prefix. */
export async function collectUploads(inputPath: string): Promise<Upload[]> {
  let info;
  try {
    info = await stat(inputPath);
  } catch {
    throw new Error(`Path not found: ${inputPath}`);
  }

  if (info.isFile()) {
    return [
      {
        key: "index.html",
        absPath: inputPath,
        contentType: contentTypeFor(basename(inputPath)),
        size: info.size,
      },
    ];
  }

  const out: Upload[] = [];
  await walkDir(inputPath, inputPath, out);
  if (out.length === 0) throw new Error(`Folder is empty: ${inputPath}`);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/walk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/walk.ts test/walk.test.ts
git commit -m "feat: add file/folder upload collection"
```

---

## Task 6: `lib/meta.ts` — metadata key, title extraction, builder

**Files:**
- Create: `src/lib/meta.ts`
- Test: `test/meta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { metaKey, extractTitle, buildMeta } from "../src/lib/meta.js";
import type { Upload } from "../src/lib/walk.js";

describe("metaKey", () => {
  it("namespaces under _meta", () => {
    expect(metaKey("abc")).toBe("_meta/abc.json");
  });
});

describe("extractTitle", () => {
  it("reads the <title>", () => {
    expect(extractTitle("<html><head><title> Hello </title></head>")).toBe(
      "Hello",
    );
  });
  it("returns null when no title", () => {
    expect(extractTitle("<html></html>")).toBeNull();
  });
});

describe("buildMeta", () => {
  it("aggregates files and bytes", () => {
    const uploads: Upload[] = [
      { key: "index.html", absPath: "/x/index.html", contentType: "text/html", size: 10 },
      { key: "a.css", absPath: "/x/a.css", contentType: "text/css", size: 5 },
    ];
    const m = buildMeta({
      code: "abc",
      slug: "abc",
      title: "T",
      uploads,
      sourcePath: "/x",
    });
    expect(m).toMatchObject({
      code: "abc",
      slug: "abc",
      title: "T",
      files: 2,
      bytes: 15,
      sourcePath: "/x",
    });
    expect(typeof m.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(m.createdAt))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/meta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { Upload } from "./walk.js";

export interface Meta {
  code: string;
  slug: string | null;
  title: string | null;
  createdAt: string; // ISO 8601
  files: number;
  bytes: number;
  sourcePath: string;
}

export function metaKey(code: string): string {
  return `_meta/${code}.json`;
}

export function extractTitle(html: string): string | null {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : null;
}

export function buildMeta(args: {
  code: string;
  slug: string | null;
  title: string | null;
  uploads: Upload[];
  sourcePath: string;
}): Meta {
  return {
    code: args.code,
    slug: args.slug,
    title: args.title,
    createdAt: new Date().toISOString(),
    files: args.uploads.length,
    bytes: args.uploads.reduce((sum, u) => sum + u.size, 0),
    sourcePath: args.sourcePath,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/meta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/meta.ts test/meta.test.ts
git commit -m "feat: add metadata key, title extraction, builder"
```

---

## Task 7: `lib/aws.ts` — S3 client + object helpers

**Files:**
- Create: `src/lib/aws.ts`
- Test: `test/aws.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  makeS3,
  putObject,
  listKeys,
  deleteKeys,
  existsPrefix,
  getJson,
} from "../src/lib/aws.js";

const s3mock = mockClient(S3Client);
beforeEach(() => s3mock.reset());

describe("aws helpers", () => {
  it("putObject sends ContentType + CacheControl", async () => {
    s3mock.on(PutObjectCommand).resolves({});
    const s3 = makeS3({ region: "us-east-1" });
    await putObject(s3, "b", "k/index.html", Buffer.from("x"), "text/html");
    const call = s3mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(call.Bucket).toBe("b");
    expect(call.Key).toBe("k/index.html");
    expect(call.ContentType).toBe("text/html");
    expect(call.CacheControl).toMatch(/max-age/);
  });

  it("listKeys paginates", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: "a" }], IsTruncated: true, NextContinuationToken: "t" })
      .resolvesOnce({ Contents: [{ Key: "b" }], IsTruncated: false });
    const keys = await listKeys(makeS3({ region: "us-east-1" }), "b", "p/");
    expect(keys).toEqual(["a", "b"]);
  });

  it("existsPrefix is true when KeyCount > 0", async () => {
    s3mock.on(ListObjectsV2Command).resolves({ KeyCount: 1 });
    expect(await existsPrefix(makeS3({ region: "us-east-1" }), "b", "p/")).toBe(true);
  });

  it("deleteKeys batches Objects", async () => {
    s3mock.on(DeleteObjectsCommand).resolves({});
    await deleteKeys(makeS3({ region: "us-east-1" }), "b", ["a", "b"]);
    const input = s3mock.commandCalls(DeleteObjectsCommand)[0].args[0].input;
    expect(input.Delete?.Objects).toEqual([{ Key: "a" }, { Key: "b" }]);
  });

  it("getJson parses the body", async () => {
    s3mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => JSON.stringify({ ok: 1 }) } as any,
    });
    const v = await getJson(makeS3({ region: "us-east-1" }), "b", "k.json");
    expect(v).toEqual({ ok: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/aws.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export function makeS3(opts: { region?: string; profile?: string }): S3Client {
  return new S3Client({
    region: opts.region,
    credentials: opts.profile
      ? fromNodeProviderChain({ profile: opts.profile })
      : undefined,
  });
}

export async function putObject(
  s3: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=300",
    }),
  );
}

export async function listKeys(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function existsPrefix(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<boolean> {
  const res = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }),
  );
  return (res.KeyCount ?? 0) > 0;
}

export async function deleteKeys(
  s3: S3Client,
  bucket: string,
  keys: string[],
): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }
}

export async function getJson<T = unknown>(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<T> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const text = await (res.Body as { transformToString(): Promise<string> }).transformToString();
  return JSON.parse(text) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/aws.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aws.ts test/aws.test.ts
git commit -m "feat: add S3 object helpers"
```

---

## Task 8: `commands/setup.ts` — create the s3-website bucket

**Files:**
- Create: `src/commands/setup.ts`
- Test: `test/setup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";
import { runSetup } from "../src/commands/setup.js";
import { loadConfig } from "../src/lib/config.js";

const s3mock = mockClient(S3Client);
let dir: string;
beforeEach(() => {
  s3mock.reset();
  s3mock.onAnyCommand().resolves({});
  dir = mkdtempSync(join(tmpdir(), "sf-setup-"));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("runSetup", () => {
  it("omits LocationConstraint for us-east-1 and writes config", async () => {
    const cfg = await runSetup({ bucket: "mybk", region: "us-east-1" });

    const create = s3mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(create.Bucket).toBe("mybk");
    expect(create.CreateBucketConfiguration).toBeUndefined();

    expect(s3mock.commandCalls(PutPublicAccessBlockCommand)).toHaveLength(1);
    expect(s3mock.commandCalls(PutBucketWebsiteCommand)).toHaveLength(1);

    const policy = JSON.parse(
      s3mock.commandCalls(PutBucketPolicyCommand)[0].args[0].input.Policy!,
    );
    const sids = policy.Statement.map((s: { Sid: string }) => s.Sid);
    expect(sids).toContain("PublicReadGetObject");
    expect(sids).toContain("DenyMetaPrefix");

    expect(cfg.mode).toBe("s3-website");
    expect(loadConfig()).toEqual(cfg);
  });

  it("sets LocationConstraint for non us-east-1 regions", async () => {
    await runSetup({ bucket: "mybk", region: "ap-northeast-2" });
    const create = s3mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(create.CreateBucketConfiguration).toEqual({
      LocationConstraint: "ap-northeast-2",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/setup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import {
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";
import { makeS3 } from "../lib/aws.js";
import { saveConfig, type Config } from "../lib/config.js";
import { websiteEndpoint } from "../lib/url.js";

export async function runSetup(args: {
  bucket: string;
  region: string;
  profile?: string;
}): Promise<Config> {
  const { bucket, region, profile } = args;
  const s3 = makeS3({ region, profile });

  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(region !== "us-east-1"
          ? { CreateBucketConfiguration: { LocationConstraint: region } }
          : {}),
      }),
    );
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou") throw err;
  }

  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    }),
  );

  await s3.send(
    new PutBucketWebsiteCommand({
      Bucket: bucket,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: "index.html" },
        ErrorDocument: { Key: "index.html" },
      },
    }),
  );

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PublicReadGetObject",
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${bucket}/*`,
      },
      {
        Sid: "DenyMetaPrefix",
        Effect: "Deny",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${bucket}/_meta/*`,
      },
    ],
  };
  await s3.send(
    new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }),
  );

  const cfg: Config = {
    mode: "s3-website",
    bucket,
    region,
    websiteEndpoint: websiteEndpoint(bucket, region),
  };
  saveConfig(cfg);
  return cfg;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/setup.ts test/setup.test.ts
git commit -m "feat: add s3-website setup command"
```

---

## Task 9: `commands/publish.ts` — upload + meta + URL

**Files:**
- Create: `src/commands/publish.ts`
- Test: `test/publish.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { runPublish } from "../src/commands/publish.js";

const s3mock = mockClient(S3Client);
let dir: string;
beforeEach(() => {
  s3mock.reset();
  s3mock.on(ListObjectsV2Command).resolves({ KeyCount: 0, Contents: [] });
  s3mock.on(PutObjectCommand).resolves({});
  dir = mkdtempSync(join(tmpdir(), "sf-pub-"));
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("runPublish", () => {
  it("uploads a folder under the slug and returns the URL", async () => {
    writeFileSync(join(dir, "index.html"), "<title>Hi</title>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "a.css"), "body{}");

    const url = await runPublish({ path: dir, slug: "doc1" });
    expect(url).toBe("http://b.s3-website-us-east-1.amazonaws.com/doc1/");

    const puts = s3mock
      .commandCalls(PutObjectCommand)
      .map((c) => c.args[0].input.Key);
    expect(puts).toContain("doc1/index.html");
    expect(puts).toContain("doc1/assets/a.css");
    expect(puts).toContain("_meta/doc1.json");
  });

  it("rejects an invalid slug", async () => {
    writeFileSync(join(dir, "index.html"), "x");
    await expect(runPublish({ path: dir, slug: "Bad Slug" })).rejects.toThrow(
      /slug/i,
    );
  });

  it("refuses to overwrite an existing slug without --force", async () => {
    s3mock.on(ListObjectsV2Command).resolves({ KeyCount: 1, Contents: [{ Key: "doc1/index.html" }] });
    writeFileSync(join(dir, "index.html"), "x");
    await expect(runPublish({ path: dir, slug: "doc1" })).rejects.toThrow(/force/);
  });

  it("dry-run uploads nothing", async () => {
    writeFileSync(join(dir, "index.html"), "x");
    await runPublish({ path: dir, slug: "doc1", dryRun: true });
    expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/publish.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { readFile } from "node:fs/promises";
import { makeS3, putObject, listKeys, existsPrefix, deleteKeys } from "../lib/aws.js";
import { resolveConfig } from "../lib/config.js";
import { generateCode, isValidSlug } from "../lib/code.js";
import { collectUploads, type Upload } from "../lib/walk.js";
import { buildMeta, metaKey, extractTitle } from "../lib/meta.js";
import { buildPublicUrl } from "../lib/url.js";
import type { S3Client } from "@aws-sdk/client-s3";

export interface PublishArgs {
  path: string;
  slug?: string;
  title?: string;
  force?: boolean;
  dryRun?: boolean;
  region?: string;
  profile?: string;
  bucket?: string;
  domain?: string;
  distribution?: string;
}

async function uniqueCode(s3: S3Client, bucket: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    if (!(await existsPrefix(s3, bucket, `${code}/`))) return code;
  }
  throw new Error("Could not generate a unique code after 5 attempts.");
}

async function deriveTitle(uploads: Upload[]): Promise<string | null> {
  const entry = uploads.find((u) => u.key === "index.html");
  if (!entry) return null;
  return extractTitle(await readFile(entry.absPath, "utf8"));
}

export async function runPublish(args: PublishArgs): Promise<string> {
  const cfg = resolveConfig({
    bucket: args.bucket,
    region: args.region,
    domain: args.domain,
    distribution: args.distribution,
  });
  const s3 = makeS3({ region: cfg.region, profile: args.profile });
  const uploads = await collectUploads(args.path);

  let code: string;
  if (args.slug) {
    if (!isValidSlug(args.slug)) {
      throw new Error(
        `Invalid slug "${args.slug}". Use lowercase letters, digits, and hyphens (must start alphanumeric).`,
      );
    }
    const exists = await existsPrefix(s3, cfg.bucket, `${args.slug}/`);
    if (exists && !args.force) {
      throw new Error(`Slug "${args.slug}" already exists. Use --force to overwrite.`);
    }
    code = args.slug;
  } else {
    code = await uniqueCode(s3, cfg.bucket);
  }

  if (args.dryRun) {
    return buildPublicUrl(cfg, code);
  }

  if (args.force) {
    const existing = await listKeys(s3, cfg.bucket, `${code}/`);
    if (existing.length) await deleteKeys(s3, cfg.bucket, existing);
  }

  for (const u of uploads) {
    await putObject(
      s3,
      cfg.bucket,
      `${code}/${u.key}`,
      await readFile(u.absPath),
      u.contentType,
    );
  }

  const title = args.title ?? (await deriveTitle(uploads));
  const meta = buildMeta({
    code,
    slug: args.slug ?? null,
    title,
    uploads,
    sourcePath: args.path,
  });
  await putObject(
    s3,
    cfg.bucket,
    metaKey(code),
    Buffer.from(JSON.stringify(meta, null, 2)),
    "application/json",
  );

  return buildPublicUrl(cfg, code);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/publish.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/publish.ts test/publish.test.ts
git commit -m "feat: add publish command"
```

---

## Task 10: `commands/list.ts` — list published docs

**Files:**
- Create: `src/commands/list.ts`
- Test: `test/list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { listDocs } from "../src/commands/list.js";

const s3mock = mockClient(S3Client);
beforeEach(() => {
  s3mock.reset();
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("listDocs", () => {
  it("reads _meta objects and attaches URLs, newest first", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "_meta/a.json" }, { Key: "_meta/b.json" }], IsTruncated: false });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/a.json" })
      .resolves({ Body: { transformToString: async () => JSON.stringify({ code: "a", slug: null, title: "A", createdAt: "2026-01-01T00:00:00Z", files: 1, bytes: 1, sourcePath: "/a" }) } as any });
    s3mock
      .on(GetObjectCommand, { Key: "_meta/b.json" })
      .resolves({ Body: { transformToString: async () => JSON.stringify({ code: "b", slug: "b", title: "B", createdAt: "2026-02-01T00:00:00Z", files: 1, bytes: 1, sourcePath: "/b" }) } as any });

    const rows = await listDocs({});
    expect(rows.map((r) => r.code)).toEqual(["b", "a"]); // newest first
    expect(rows[0].url).toBe("http://b.s3-website-us-east-1.amazonaws.com/b/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/list.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { makeS3, listKeys, getJson } from "../lib/aws.js";
import { resolveConfig, type Overrides } from "../lib/config.js";
import { buildPublicUrl } from "../lib/url.js";
import type { Meta } from "../lib/meta.js";

export interface DocRow extends Meta {
  url: string;
}

export async function listDocs(
  flags: Overrides & { profile?: string },
): Promise<DocRow[]> {
  const cfg = resolveConfig(flags);
  const s3 = makeS3({ region: cfg.region, profile: flags.profile });
  const keys = await listKeys(s3, cfg.bucket, "_meta/");

  const rows: DocRow[] = [];
  for (const key of keys) {
    const meta = await getJson<Meta>(s3, cfg.bucket, key);
    rows.push({ ...meta, url: buildPublicUrl(cfg, meta.code) });
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows;
}

export function formatRows(rows: DocRow[]): string {
  if (rows.length === 0) return "No documents published yet.";
  return rows
    .map(
      (r) =>
        `${r.code}\t${r.slug ?? "-"}\t${r.title ?? "-"}\t${r.createdAt}\t${r.url}`,
    )
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/list.ts test/list.test.ts
git commit -m "feat: add list command"
```

---

## Task 11: `commands/rm.ts` — delete a document

**Files:**
- Create: `src/commands/rm.ts`
- Test: `test/rm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { runRm } from "../src/commands/rm.js";

const s3mock = mockClient(S3Client);
beforeEach(() => {
  s3mock.reset();
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("runRm", () => {
  it("deletes the prefix objects plus the meta object", async () => {
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "doc1/index.html" }, { Key: "doc1/a.css" }], IsTruncated: false });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await runRm({ id: "doc1", yes: true });

    const deleted = s3mock
      .commandCalls(DeleteObjectsCommand)[0]
      .args[0].input.Delete?.Objects?.map((o) => o.Key);
    expect(deleted).toContain("doc1/index.html");
    expect(deleted).toContain("doc1/a.css");
    expect(deleted).toContain("_meta/doc1.json");
  });

  it("throws when the document does not exist", async () => {
    s3mock.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: false });
    await expect(runRm({ id: "ghost", yes: true })).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { makeS3, listKeys, deleteKeys } from "../lib/aws.js";
import { resolveConfig, type Overrides } from "../lib/config.js";
import { metaKey } from "../lib/meta.js";

export async function runRm(
  args: { id: string; yes?: boolean } & Overrides & { profile?: string },
): Promise<void> {
  const cfg = resolveConfig(args);
  const s3 = makeS3({ region: cfg.region, profile: args.profile });

  const keys = await listKeys(s3, cfg.bucket, `${args.id}/`);
  if (keys.length === 0) {
    throw new Error(`Document not found: ${args.id}`);
  }
  await deleteKeys(s3, cfg.bucket, [...keys, metaKey(args.id)]);
  // Phase 2 (cloudfront mode): invalidate /<id>/* here.
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/rm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rm.ts test/rm.test.ts
git commit -m "feat: add rm command"
```

---

## Task 12: `lib/browser.ts` + `commands/open.ts` + `commands/config.ts`

**Files:**
- Create: `src/lib/browser.ts`, `src/commands/open.ts`, `src/commands/config.ts`
- Test: `test/open.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveOpenUrl } from "../src/commands/open.js";
import { describeConfig } from "../src/commands/config.js";
import { openerCommand } from "../src/lib/browser.js";

beforeEach(() => {
  process.env.HOSTDOC_BUCKET = "b";
  process.env.HOSTDOC_REGION = "us-east-1";
});
afterEach(() => {
  delete process.env.HOSTDOC_BUCKET;
  delete process.env.HOSTDOC_REGION;
});

describe("openerCommand", () => {
  it("selects the platform opener", () => {
    expect(openerCommand("darwin").cmd).toBe("open");
    expect(openerCommand("linux").cmd).toBe("xdg-open");
    expect(openerCommand("win32").cmd).toBe("cmd");
  });
});

describe("resolveOpenUrl", () => {
  it("builds the URL for a code", () => {
    expect(resolveOpenUrl({ id: "abc" })).toBe(
      "http://b.s3-website-us-east-1.amazonaws.com/abc/",
    );
  });
});

describe("describeConfig", () => {
  it("summarizes the active config", () => {
    expect(describeConfig({})).toMatch(/s3-website/);
    expect(describeConfig({})).toMatch(/bucket: b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/open.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/lib/browser.ts`:
```ts
import { spawn } from "node:child_process";

export function openerCommand(platform: NodeJS.Platform): {
  cmd: string;
  args: (url: string) => string[];
} {
  if (platform === "darwin") return { cmd: "open", args: (u) => [u] };
  if (platform === "win32") return { cmd: "cmd", args: (u) => ["/c", "start", "", u] };
  return { cmd: "xdg-open", args: (u) => [u] };
}

export function openInBrowser(url: string): void {
  const { cmd, args } = openerCommand(process.platform);
  spawn(cmd, args(url), { stdio: "ignore", detached: true }).unref();
}
```

`src/commands/open.ts`:
```ts
import { resolveConfig, type Overrides } from "../lib/config.js";
import { buildPublicUrl } from "../lib/url.js";
import { openInBrowser } from "../lib/browser.js";

export function resolveOpenUrl(
  args: { id: string } & Overrides,
): string {
  const cfg = resolveConfig(args);
  return buildPublicUrl(cfg, args.id);
}

export function runOpen(args: { id: string } & Overrides): string {
  const url = resolveOpenUrl(args);
  openInBrowser(url);
  return url;
}
```

`src/commands/config.ts`:
```ts
import { resolveConfig, type Overrides } from "../lib/config.js";

export function describeConfig(flags: Overrides): string {
  const cfg = resolveConfig(flags);
  const lines = [
    `mode: ${cfg.mode}`,
    `bucket: ${cfg.bucket}`,
    `region: ${cfg.region}`,
  ];
  if (cfg.mode === "s3-website") lines.push(`websiteEndpoint: ${cfg.websiteEndpoint}`);
  else lines.push(`domain: ${cfg.domain}`, `distributionId: ${cfg.distributionId}`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/open.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/browser.ts src/commands/open.ts src/commands/config.ts test/open.test.ts
git commit -m "feat: add open and config commands"
```

---

## Task 13: `src/index.ts` — CLI wiring + README + build

**Files:**
- Create: `src/index.ts`, `README.md`

- [ ] **Step 1: Write `src/index.ts`**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { runSetup } from "./commands/setup.js";
import { runPublish } from "./commands/publish.js";
import { listDocs, formatRows } from "./commands/list.js";
import { runRm } from "./commands/rm.js";
import { runOpen } from "./commands/open.js";
import { describeConfig } from "./commands/config.js";

const program = new Command();
program
  .name("hostdoc")
  .description("Publish a local HTML file or folder to your own AWS and get a short link.")
  .option("--profile <name>", "AWS profile")
  .option("--region <region>", "AWS region")
  .option("--bucket <name>", "override bucket")
  .option("--domain <domain>", "override domain (cloudfront mode)")
  .option("--distribution <id>", "override distribution id (cloudfront mode)");

const globals = () => program.opts<{
  profile?: string;
  region?: string;
  bucket?: string;
  domain?: string;
  distribution?: string;
}>();

function fail(err: unknown): never {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}

program
  .command("setup")
  .description("Create a public S3 static-website bucket and save config")
  .requiredOption("--bucket <name>", "bucket name to create")
  .requiredOption("--region <region>", "AWS region for the bucket")
  .action(async (opts) => {
    try {
      const cfg = await runSetup({ bucket: opts.bucket, region: opts.region, profile: globals().profile });
      console.log(`Created s3-website bucket "${cfg.bucket}".`);
      console.log(`Public base: ${cfg.websiteEndpoint}/`);
      console.log("Note: this bucket serves content publicly over HTTP.");
    } catch (err) { fail(err); }
  });

program
  .command("publish <path>")
  .description("Publish a file or folder; prints the public URL")
  .option("--slug <name>", "custom slug instead of a random code")
  .option("--title <title>", "override the document title")
  .option("--force", "overwrite an existing slug")
  .option("--open", "open the URL in your browser")
  .option("--dry-run", "show the URL without uploading")
  .action(async (path, opts) => {
    try {
      const g = globals();
      const url = await runPublish({
        path, slug: opts.slug, title: opts.title, force: opts.force, dryRun: opts.dryRun,
        profile: g.profile, region: g.region, bucket: g.bucket, domain: g.domain, distribution: g.distribution,
      });
      console.log(url);
      if (opts.open && !opts.dryRun) runOpen({ id: url.split("/").slice(-2, -1)[0] });
    } catch (err) { fail(err); }
  });

program
  .command("list")
  .description("List published documents")
  .action(async () => {
    try {
      const rows = await listDocs(globals());
      console.log(formatRows(rows));
    } catch (err) { fail(err); }
  });

program
  .command("rm <id>")
  .description("Delete a document by code or slug")
  .option("--yes", "skip confirmation")
  .action(async (id, opts) => {
    try {
      await runRm({ id, yes: opts.yes, ...globals() });
      console.log(`Deleted ${id}.`);
    } catch (err) { fail(err); }
  });

program
  .command("open <id>")
  .description("Open a document's URL in your browser")
  .action((id) => {
    try {
      console.log(runOpen({ id, ...globals() }));
    } catch (err) { fail(err); }
  });

program
  .command("config")
  .description("Show the active configuration")
  .action(() => {
    try {
      console.log(describeConfig(globals()));
    } catch (err) { fail(err); }
  });

program.parseAsync();
```

- [ ] **Step 2: Build and smoke-test the CLI**

Run:
```bash
npm run build
node dist/index.js --help
```
Expected: build succeeds; help output lists `setup`, `publish`, `list`, `rm`, `open`, `config`.

- [ ] **Step 3: Verify the no-config error path**

Run:
```bash
env -u HOSTDOC_BUCKET -u HOSTDOC_REGION XDG_CONFIG_HOME=/tmp/sf-empty node dist/index.js list
```
Expected: exits non-zero with `Error: No configuration found. Run \`hostdoc setup\`...`.

- [ ] **Step 4: Write `README.md`**

````markdown
# hostdoc

Publish a local HTML file or folder to **your own AWS** and get a short shareable link.

> Phase 1 ships the **no-domain (S3 website)** mode: an HTTP link served straight from an S3 static-website bucket. Custom-domain HTTPS via CloudFront is Phase 2.

## Install

```bash
npm install -g hostdoc
```

## Quick start (no domain)

Requires AWS credentials available to the SDK (env vars, a shared profile via `--profile`, or SSO).

```bash
# 1) Create a public website bucket and save config
hostdoc setup --bucket my-unique-bucket --region us-east-1

# 2) Publish
hostdoc publish ./report.html            # → http://<bucket>.s3-website-...amazonaws.com/<code>/
hostdoc publish ./site/ --slug aws-design

# 3) Manage
hostdoc list
hostdoc open aws-design
hostdoc rm aws-design --yes
```

Note: no-domain mode serves content **publicly over HTTP** (S3 website endpoints do not support HTTPS). For public-facing HTTPS use the upcoming domain mode.

## Credentials

`hostdoc` never stores AWS keys. It uses the AWS SDK default credential chain (environment variables → SSO → shared `~/.aws` profile). Select a profile with `--profile <name>` and a region with `--region <region>`.

## Configuration precedence

Flags (`--bucket/--region/...`) > `HOSTDOC_*` env vars > `~/.config/hostdoc/config.json`.

## License

MIT
````

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS — all suites green.

```bash
git add -A
git commit -m "feat: wire CLI entrypoint and add README"
```

---

## Self-Review

**Spec coverage** (spec → task):
- 입력 파일/폴더 → `<code>/` → Task 5 (walk) + Task 9 (publish).
- 자격증명 SDK 체인 + `--profile`/`--region` → Task 7 (`makeS3`) + Task 13 (global options).
- 랜덤 코드 + `--slug` + 충돌/`--force` → Task 1 + Task 9.
- s3-website 호스팅 + URL → Task 3 + Task 8.
- 메타 `_meta/<code>.json` + `list` → Task 6 + Task 10; `_meta` Deny → Task 8 policy.
- `setup`/`publish`/`list`/`rm`/`open`/`config` → Tasks 8–13.
- 설정 우선순위 flag>env>file → Task 4.
- Content-Type per extension → Task 2 + Task 9 (`putObject`).
- `--dry-run` → Task 9 + Task 13.
- 테스트(단위+aws-sdk-client-mock) → every task.
- **Deferred to Phase 2 (out of this plan, by design):** Terraform `infra/`, CloudFront mode end-to-end, `init --from-terraform`, CloudFront invalidation on overwrite/rm (stubbed comment in Tasks 9/11), CI workflow, LICENSE file, clipboard copy on publish.

**Placeholder scan:** none — every step has runnable code/commands.

**Type consistency:** `Config`, `Overrides`, `Upload`, `Meta`, `DocRow` are defined once and imported; `resolveConfig(flags)`, `makeS3({region,profile})`, `listKeys/deleteKeys/existsPrefix/getJson/putObject`, `buildPublicUrl(cfg,code)`, `metaKey(code)` signatures match across producer and consumer tasks. `rm` uses `{ id }`; `open` uses `{ id }`; publish derives the code for `--open` from the URL's penultimate path segment.

## Phase 2 (separate plan — not in scope here)
Terraform `infra/` (S3 private + OAC + CloudFront + Function + ACM us-east-1 + Route53), `init --from-terraform`, CloudFront invalidation wired into `publish`/`rm` for `mode: cloudfront`, CI (`terraform fmt/validate/plan`, lint, test), `LICENSE`, and README domain-mode section.
