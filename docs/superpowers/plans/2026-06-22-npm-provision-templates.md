# Bundle Terraform Templates for npm-Installed `provision` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `npm i -g hostdoc` users run `hostdoc provision --hosted-zone <z> --subdomain <s> --region <r>` (and `deprovision`) with no repo checkout and no file editing.

**Architecture:** A build step copies a clean allowlist of the six git-tracked `infra/` files into `dist/templates/infra/` (single source of truth, structurally leak-proof). At runtime, `provision`/`deprovision` extract those templates into `--dir` when it has no `.tf`, generate `terraform.tfvars` from CLI flags (flags win; an existing tfvars is a cache), then run terraform. State and user values live only in the user's working dir.

**Tech Stack:** TypeScript (ESM, `tsc` build), Node ≥22.12, Commander 15, Vitest 4, `aws-sdk-client-mock`, Terraform (shelled out, mocked in tests).

## Global Constraints

- ESM: relative imports in `.ts` source need a `.js` extension (e.g. `./lib/tfvars.js`).
- CI runs build→typecheck→test with **no AWS creds and no Terraform**; terraform is mocked via `vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }))`.
- `package.json` stays `files: ["dist"]`; templates must ship *under* `dist/`.
- Template allowlist is exactly these six files, copied from `infra/`: `main.tf`, `variables.tf`, `outputs.tf`, `index-rewrite.js`, `terraform.tfvars.example`, `.terraform.lock.hcl`. Never copy `*.tfstate*` or `terraform.tfvars`.
- Flag → tfvars key map: `--hosted-zone`→`hosted_zone_name`, `--subdomain`→`subdomain`, `--region`→`aws_region`, `--price-class`→`price_class` (optional; tf default `PriceClass_100`).
- Commit messages follow Conventional Commits (semantic-release is wired on `main`).
- Run a single test file with `npx vitest run test/<name>.test.ts`; full suite with `npm test`.

## File Structure

- `scripts/copy-templates.mjs` (new) — build-time allowlist copy `infra/` → `dist/templates/infra/`.
- `package.json` (modify) — `build` script runs the copy after `tsc`.
- `src/lib/templates.ts` (new) — `bundledTemplatesDir`, `hasTfFiles`, `extractTemplates`, `TEMPLATE_FILES`.
- `src/lib/tfvars.ts` (new) — `TfvarsFlags`, `writeTfvars`, `hasTfvars`, `tfvarsPath`, `ensureTfvars`.
- `src/commands/provision.ts` (modify) — `runProvision` extracts + ensures tfvars before terraform.
- `src/commands/deprovision.ts` (modify) — `runDeprovision` extracts + ensures tfvars before terraform.
- `src/index.ts` (modify) — add the four flags to `provision` and `deprovision`; pass a `flags` object.
- `README.md` (modify) — npm-only domain-mode flow.
- Tests: `test/pack.test.ts` (new), `test/templates.test.ts` (new), `test/tfvars.test.ts` (new), `test/provision.test.ts` (rewrite), `test/deprovision.test.ts` (rewrite).

---

## Task 1: Build-time template bundling + tarball guardrail

**Files:**
- Create: `scripts/copy-templates.mjs`
- Modify: `package.json` (the `build` script)
- Test: `test/pack.test.ts`

**Interfaces:**
- Consumes: the six git-tracked files in `infra/`.
- Produces: `dist/templates/infra/<allowlist>` after `npm run build`.

- [ ] **Step 1: Write the failing test**

Create `test/pack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

// Assumes `npm run build` has run (CI order is build→typecheck→test), so
// dist/templates/infra exists. --ignore-scripts packs the current dist as-is.
function packedFiles(): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0].files.map((f) => f.path);
}

describe("npm pack tarball", () => {
  it("ships the variable-only templates", () => {
    const files = packedFiles();
    for (const f of [
      "dist/templates/infra/main.tf",
      "dist/templates/infra/variables.tf",
      "dist/templates/infra/outputs.tf",
      "dist/templates/infra/index-rewrite.js",
      "dist/templates/infra/terraform.tfvars.example",
      "dist/templates/infra/.terraform.lock.hcl",
    ]) {
      expect(files).toContain(f);
    }
  });

  it("never ships state or real tfvars", () => {
    const files = packedFiles();
    expect(files.some((p) => p.includes(".tfstate"))).toBe(false);
    expect(files.some((p) => /(^|\/)terraform\.tfvars$/.test(p))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pack.test.ts`
Expected: FAIL — `dist/templates/infra/main.tf` not in the file list (templates aren't built yet).

- [ ] **Step 3: Create the copy script**

Create `scripts/copy-templates.mjs`:

```js
// Copies the variable-only Terraform templates from infra/ into
// dist/templates/infra/ so they ship in the npm tarball (files: ["dist"]).
// Allowlist, never a denylist: a *.tfstate or terraform.tfvars can never be
// copied even if it appears in infra/.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "infra");
const DEST = join(ROOT, "dist", "templates", "infra");

const FILES = [
  "main.tf",
  "variables.tf",
  "outputs.tf",
  "index-rewrite.js",
  "terraform.tfvars.example",
  ".terraform.lock.hcl",
];

mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  copyFileSync(join(SRC, f), join(DEST, f));
}
console.log(`Copied ${FILES.length} template files to dist/templates/infra/`);
```

- [ ] **Step 4: Wire the build script**

In `package.json`, change the `build` script from:

```json
    "build": "tsc",
```

to:

```json
    "build": "tsc && node scripts/copy-templates.mjs",
```

(`prepack` already runs `npm run build`, so templates ship automatically.)

- [ ] **Step 5: Build, then run the test to verify it passes**

Run: `npm run build && npx vitest run test/pack.test.ts`
Expected: PASS — both tests green; build prints `Copied 6 template files to dist/templates/infra/`.

- [ ] **Step 6: Commit**

```bash
git add scripts/copy-templates.mjs package.json test/pack.test.ts
git commit -m "build: bundle variable-only Terraform templates into dist (#8)"
```

---

## Task 2: `src/lib/templates.ts` — extract bundled templates

**Files:**
- Create: `src/lib/templates.ts`
- Test: `test/templates.test.ts`

**Interfaces:**
- Produces:
  - `TEMPLATE_FILES: readonly string[]`
  - `bundledTemplatesDir(): string`
  - `hasTfFiles(dir: string): boolean`
  - `extractTemplates(destDir: string, srcDir?: string): { extracted: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `test/templates.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTemplates, hasTfFiles, TEMPLATE_FILES } from "../src/lib/templates.js";

let src: string;
let dest: string;

beforeEach(() => {
  // A fake "bundled templates" dir so the test needs no build.
  src = mkdtempSync(join(tmpdir(), "hostdoc-tpl-src-"));
  for (const f of TEMPLATE_FILES) writeFileSync(join(src, f), `# ${f}\n`);
  dest = mkdtempSync(join(tmpdir(), "hostdoc-tpl-dest-"));
});

describe("extractTemplates", () => {
  it("copies every allowlisted file into an empty dir", () => {
    const target = join(dest, "infra");
    const res = extractTemplates(target, src);
    expect(res.extracted).toBe(true);
    for (const f of TEMPLATE_FILES) {
      expect(existsSync(join(target, f))).toBe(true);
    }
  });

  it("is a no-op when the dir already has a .tf (never clobbers)", () => {
    mkdirSync(join(dest, "infra"), { recursive: true });
    const target = join(dest, "infra");
    writeFileSync(join(target, "main.tf"), "# user edits\n");
    const res = extractTemplates(target, src);
    expect(res.extracted).toBe(false);
    expect(readFileSync(join(target, "main.tf"), "utf8")).toBe("# user edits\n");
    expect(existsSync(join(target, "variables.tf"))).toBe(false);
  });
});

describe("hasTfFiles", () => {
  it("is false for a missing or .tf-free dir, true once a .tf exists", () => {
    const d = join(dest, "x");
    expect(hasTfFiles(d)).toBe(false);
    mkdirSync(d, { recursive: true });
    expect(hasTfFiles(d)).toBe(false);
    writeFileSync(join(d, "main.tf"), "");
    expect(hasTfFiles(d)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/templates.test.ts`
Expected: FAIL — cannot resolve `../src/lib/templates.js` (module not created yet).

- [ ] **Step 3: Implement `src/lib/templates.ts`**

```ts
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Files copied from infra/ into the package by scripts/copy-templates.mjs. */
export const TEMPLATE_FILES = [
  "main.tf",
  "variables.tf",
  "outputs.tf",
  "index-rewrite.js",
  "terraform.tfvars.example",
  ".terraform.lock.hcl",
] as const;

/** Path to the bundled templates shipped under dist/templates/infra/. */
export function bundledTemplatesDir(): string {
  // dist/lib/templates.js -> dist/templates/infra
  return fileURLToPath(new URL("../templates/infra/", import.meta.url));
}

/** Whether <dir> already contains any Terraform (*.tf) files. */
export function hasTfFiles(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".tf"));
}

/**
 * Extract the bundled Terraform templates into <destDir>. No-op when <destDir>
 * already has .tf files (never clobber a user's edited infra). Returns whether
 * files were written.
 */
export function extractTemplates(
  destDir: string,
  srcDir: string = bundledTemplatesDir(),
): { extracted: boolean } {
  if (hasTfFiles(destDir)) return { extracted: false };
  mkdirSync(destDir, { recursive: true });
  for (const f of TEMPLATE_FILES) {
    copyFileSync(join(srcDir, f), join(destDir, f));
  }
  return { extracted: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/templates.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates.ts test/templates.test.ts
git commit -m "feat: extract bundled Terraform templates into the working dir (#8)"
```

---

## Task 3: `src/lib/tfvars.ts` — generate tfvars from flags

**Files:**
- Create: `src/lib/tfvars.ts`
- Test: `test/tfvars.test.ts`

**Interfaces:**
- Produces:
  - `interface TfvarsFlags { hostedZone?: string; subdomain?: string; region?: string; priceClass?: string }`
  - `tfvarsPath(dir: string): string`
  - `hasTfvars(dir: string): boolean`
  - `writeTfvars(dir: string, vars: { hostedZone: string; subdomain: string; region: string; priceClass?: string }): void`
  - `ensureTfvars(dir: string, flags: TfvarsFlags): void`

- [ ] **Step 1: Write the failing tests**

Create `test/tfvars.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTfvars, ensureTfvars, tfvarsPath } from "../src/lib/tfvars.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hostdoc-tfvars-"));
});

describe("writeTfvars", () => {
  it("emits HCL for the required vars plus price_class", () => {
    writeTfvars(dir, {
      hostedZone: "example.com",
      subdomain: "shared",
      region: "us-east-1",
      priceClass: "PriceClass_100",
    });
    const txt = readFileSync(tfvarsPath(dir), "utf8");
    expect(txt).toContain('hosted_zone_name = "example.com"');
    expect(txt).toContain('subdomain        = "shared"');
    expect(txt).toContain('aws_region       = "us-east-1"');
    expect(txt).toContain('price_class      = "PriceClass_100"');
  });

  it("omits price_class when not provided", () => {
    writeTfvars(dir, { hostedZone: "a.com", subdomain: "s", region: "r" });
    expect(readFileSync(tfvarsPath(dir), "utf8")).not.toContain("price_class");
  });

  it("escapes quotes in values", () => {
    writeTfvars(dir, { hostedZone: 'a"b.com', subdomain: "s", region: "r" });
    expect(readFileSync(tfvarsPath(dir), "utf8")).toContain('hosted_zone_name = "a\\"b.com"');
  });
});

describe("ensureTfvars", () => {
  it("writes tfvars when all three required flags are present", () => {
    ensureTfvars(dir, { hostedZone: "example.com", subdomain: "shared", region: "us-east-1" });
    expect(readFileSync(tfvarsPath(dir), "utf8")).toContain('subdomain        = "shared"');
  });

  it("overwrites an existing tfvars (flags win)", () => {
    writeFileSync(tfvarsPath(dir), 'subdomain = "old"\n');
    ensureTfvars(dir, { hostedZone: "new.com", subdomain: "fresh", region: "r" });
    expect(readFileSync(tfvarsPath(dir), "utf8")).toContain('subdomain        = "fresh"');
  });

  it("throws naming the missing flag when only some required flags are given", () => {
    expect(() => ensureTfvars(dir, { hostedZone: "example.com" })).toThrow(/--subdomain.*--region|--region.*--subdomain/);
  });

  it("uses an existing tfvars when no flags are given", () => {
    writeFileSync(tfvarsPath(dir), 'subdomain = "cached"\n');
    expect(() => ensureTfvars(dir, {})).not.toThrow();
    expect(readFileSync(tfvarsPath(dir), "utf8")).toBe('subdomain = "cached"\n');
  });

  it("throws when no flags and no tfvars exist", () => {
    expect(() => ensureTfvars(dir, {})).toThrow(/--hosted-zone/);
    expect(existsSync(tfvarsPath(dir))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/tfvars.test.ts`
Expected: FAIL — cannot resolve `../src/lib/tfvars.js`.

- [ ] **Step 3: Implement `src/lib/tfvars.ts`**

```ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TfvarsFlags {
  hostedZone?: string;
  subdomain?: string;
  region?: string;
  priceClass?: string;
}

const TFVARS = "terraform.tfvars";

export function tfvarsPath(dir: string): string {
  return join(dir, TFVARS);
}

export function hasTfvars(dir: string): boolean {
  return existsSync(tfvarsPath(dir));
}

/** HCL string literal: escape backslash and double-quote. */
function hcl(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Write terraform.tfvars in <dir>. price_class is only emitted when provided
 * (Terraform supplies its own default otherwise).
 */
export function writeTfvars(
  dir: string,
  vars: { hostedZone: string; subdomain: string; region: string; priceClass?: string },
): void {
  const lines = [
    `hosted_zone_name = ${hcl(vars.hostedZone)}`,
    `subdomain        = ${hcl(vars.subdomain)}`,
    `aws_region       = ${hcl(vars.region)}`,
  ];
  if (vars.priceClass) lines.push(`price_class      = ${hcl(vars.priceClass)}`);
  writeFileSync(tfvarsPath(dir), lines.join("\n") + "\n");
}

/**
 * Resolve terraform.tfvars for provision/deprovision: flags win, an existing
 * tfvars is a cache.
 *  - all three required flags present  -> write (overwriting any existing)
 *  - some but not all required present -> throw, naming the missing flags
 *  - none present + existing tfvars    -> use it (no-op)
 *  - none present + no tfvars          -> throw with guidance
 */
export function ensureTfvars(dir: string, flags: TfvarsFlags): void {
  const required: Record<string, string | undefined> = {
    "--hosted-zone": flags.hostedZone,
    "--subdomain": flags.subdomain,
    "--region": flags.region,
  };
  const present = Object.values(required).filter(Boolean).length;
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (present === 3) {
    writeTfvars(dir, {
      hostedZone: flags.hostedZone!,
      subdomain: flags.subdomain!,
      region: flags.region!,
      priceClass: flags.priceClass,
    });
    return;
  }
  if (present > 0) {
    throw new Error(
      `Missing required flag(s): ${missing.join(", ")} ` +
        `(provide all of --hosted-zone, --subdomain, --region together).`,
    );
  }
  if (hasTfvars(dir)) return;
  throw new Error(
    `No terraform.tfvars in "${dir}". Pass --hosted-zone <zone> --subdomain <sub> ` +
      `--region <region> (or create ${TFVARS} yourself).`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tfvars.test.ts`
Expected: PASS — all writeTfvars and ensureTfvars cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tfvars.ts test/tfvars.test.ts
git commit -m "feat: generate terraform.tfvars from CLI flags (flags win, tfvars caches) (#8)"
```

---

## Task 4: Wire `provision` — extract + ensure tfvars + flags

**Files:**
- Modify: `src/commands/provision.ts`
- Modify: `src/index.ts` (the `provision` command block, ~lines 79–94)
- Test: `test/provision.test.ts` (rewrite)

**Interfaces:**
- Consumes: `extractTemplates` (Task 2), `ensureTfvars`, `TfvarsFlags` (Task 3), `runInit` (existing).
- Produces: `runProvision(args: { dir: string; approve?: boolean; flags?: TfvarsFlags }): Config`.

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `test/provision.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { runProvision } from "../src/commands/provision.js";
import { loadConfig } from "../src/lib/config.js";

const mockExec = vi.mocked(execFileSync);

const OUTPUTS = JSON.stringify({
  bucket_name: { value: "shared.example.com" },
  region: { value: "ap-northeast-2" },
  distribution_id: { value: "E123ABC" },
  site_domain: { value: "shared.example.com" },
});

const FLAGS = { hostedZone: "example.com", subdomain: "shared", region: "ap-northeast-2" };

let dir: string;
beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockImplementation((_cmd, args) =>
    (args as string[]).includes("output") ? OUTPUTS : "",
  );
  // Seed a .tf so extractTemplates() no-ops (no build needed in tests).
  dir = mkdtempSync(join(tmpdir(), "hostdoc-prov-"));
  writeFileSync(join(dir, "main.tf"), "# seeded\n");
});

describe("runProvision", () => {
  it("writes tfvars from flags, runs init then apply, writes a cloudfront config", () => {
    const cfg = runProvision({ dir, flags: FLAGS });

    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toContain(
      'hosted_zone_name = "example.com"',
    );

    const argLists = mockExec.mock.calls.map((c) => c[1] as string[]);
    const initIdx = argLists.findIndex((a) => a.includes("init"));
    const applyIdx = argLists.findIndex((a) => a.includes("apply"));
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(applyIdx).toBeGreaterThan(initIdx);
    expect(argLists[initIdx]).toContain(`-chdir=${dir}`);
    expect(argLists[applyIdx]).not.toContain("-auto-approve");

    expect(cfg.mode).toBe("cloudfront");
    expect(cfg.domain).toBe("shared.example.com");
    expect(loadConfig()).toEqual(cfg);
  });

  it("lets flags overwrite an existing tfvars", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "old"\n');
    runProvision({ dir, flags: { ...FLAGS, subdomain: "fresh" } });
    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toContain(
      'subdomain        = "fresh"',
    );
  });

  it("uses an existing tfvars when no flags are passed", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "cached"\n');
    expect(() => runProvision({ dir })).not.toThrow();
    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toBe('subdomain = "cached"\n');
  });

  it("throws before terraform when no flags and no tfvars exist", () => {
    expect(() => runProvision({ dir })).toThrow(/--hosted-zone/);
    const ranTerraform = mockExec.mock.calls.some((c) =>
      (c[1] as string[]).some((a) => a.includes("init") || a.includes("apply")),
    );
    expect(ranTerraform).toBe(false);
  });

  it("appends -auto-approve when approve is set", () => {
    runProvision({ dir, approve: true, flags: FLAGS });
    const applyCall = mockExec.mock.calls
      .map((c) => c[1] as string[])
      .find((a) => a.includes("apply"));
    expect(applyCall).toContain("-auto-approve");
  });

  it("fails fast if terraform init fails (apply never reached)", () => {
    mockExec.mockImplementation((_cmd, args) => {
      if ((args as string[]).includes("init")) throw new Error("terraform init failed");
      return "";
    });
    expect(() => runProvision({ dir, flags: FLAGS })).toThrow(/init failed/);
    const reachedApply = mockExec.mock.calls.some((c) => (c[1] as string[]).includes("apply"));
    expect(reachedApply).toBe(false);
  });

  it("reports a friendly error when terraform is not installed", () => {
    mockExec.mockImplementation(() => {
      throw Object.assign(new Error("spawnSync terraform ENOENT"), { code: "ENOENT" });
    });
    expect(() => runProvision({ dir, flags: FLAGS })).toThrow(/terraform is not installed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/provision.test.ts`
Expected: FAIL — `runProvision` doesn't accept `flags` / doesn't write tfvars yet.

- [ ] **Step 3: Update `src/commands/provision.ts`**

Replace the file with:

```ts
import { terraform } from "../lib/terraform.js";
import { extractTemplates } from "../lib/templates.js";
import { ensureTfvars, type TfvarsFlags } from "../lib/tfvars.js";
import { runInit } from "./init.js";
import type { Config } from "../lib/config.js";

/**
 * Provision the domain (CloudFront) infrastructure via Terraform, then import
 * its outputs into a cloudfront config. Extracts the bundled templates into
 * `dir` when it has no `.tf`, and writes `terraform.tfvars` from `flags`
 * (flags win; an existing tfvars is reused when no flags are given).
 * `terraform apply` streams its plan and confirmation prompt; pass `approve`
 * for non-interactive `-auto-approve` (e.g. when hostdoc is driven by an agent).
 */
export function runProvision(args: {
  dir: string;
  approve?: boolean;
  flags?: TfvarsFlags;
}): Config {
  extractTemplates(args.dir);
  ensureTfvars(args.dir, args.flags ?? {});

  // init is always non-interactive; the apply prompt is the human gate.
  terraform(args.dir, ["init", "-input=false"]);

  const applyArgs = ["apply"];
  if (args.approve) applyArgs.push("-auto-approve");
  terraform(args.dir, applyArgs);

  return runInit({ dir: args.dir });
}
```

- [ ] **Step 4: Add the flags to the `provision` command in `src/index.ts`**

Replace the `provision` command block (currently lines ~79–94) with:

```ts
program
  .command("provision")
  .description("Provision domain infra via Terraform (init + apply) and write a cloudfront config")
  .option("--dir <dir>", "Terraform infra directory", "./infra")
  .option("--hosted-zone <zone>", "existing Route53 hosted zone (domain mode)")
  .option("--subdomain <sub>", "subdomain; the site is <subdomain>.<hosted-zone>")
  .option("--region <region>", "AWS region for the S3 bucket (cert is always us-east-1)")
  .option("--price-class <class>", "CloudFront price class (default PriceClass_100)")
  .option("--approve", "auto-approve terraform apply (non-interactive; for agents/automation)")
  .action((opts) => {
    try {
      const cfg = runProvision({
        dir: opts.dir,
        approve: opts.approve,
        flags: {
          hostedZone: opts.hostedZone,
          subdomain: opts.subdomain,
          region: opts.region,
          priceClass: opts.priceClass,
        },
      });
      console.log(
        `Provisioned ${cfg.domain}; cloudfront config written (distribution ${cfg.distributionId}).`,
      );
    } catch (err) {
      fail(err);
    }
  });
```

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `npx vitest run test/provision.test.ts && npm run typecheck`
Expected: PASS — all provision tests green; typecheck clean.

- [ ] **Step 6: Verify the CLI exposes the flags**

Run: `npm run dev -- provision --help`
Expected: help output lists `--hosted-zone`, `--subdomain`, `--region`, `--price-class`.

- [ ] **Step 7: Commit**

```bash
git add src/commands/provision.ts src/index.ts test/provision.test.ts
git commit -m "feat: provision extracts templates and accepts domain flags (#8)"
```

---

## Task 5: Wire `deprovision` — extract + ensure tfvars + flags

**Files:**
- Modify: `src/commands/deprovision.ts`
- Modify: `src/index.ts` (the `deprovision` command block)
- Test: `test/deprovision.test.ts` (rewrite)

**Interfaces:**
- Consumes: `extractTemplates` (Task 2), `ensureTfvars`, `TfvarsFlags` (Task 3).
- Produces: `runDeprovision(args: { dir: string; approve?: boolean; flags?: TfvarsFlags }): void`.

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `test/deprovision.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { runDeprovision } from "../src/commands/deprovision.js";

const mockExec = vi.mocked(execFileSync);
const FLAGS = { hostedZone: "example.com", subdomain: "shared", region: "ap-northeast-2" };

let dir: string;
beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockReturnValue("");
  dir = mkdtempSync(join(tmpdir(), "hostdoc-deprov-"));
  writeFileSync(join(dir, "main.tf"), "# seeded\n"); // extractTemplates no-ops
});

describe("runDeprovision", () => {
  it("writes tfvars from flags, runs init then destroy (interactive by default)", () => {
    runDeprovision({ dir, flags: FLAGS });

    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toContain(
      'aws_region       = "ap-northeast-2"',
    );
    const argLists = mockExec.mock.calls.map((c) => c[1] as string[]);
    const initIdx = argLists.findIndex((a) => a.includes("init"));
    const destroyIdx = argLists.findIndex((a) => a.includes("destroy"));
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(destroyIdx).toBeGreaterThan(initIdx);
    expect(argLists[destroyIdx]).toContain(`-chdir=${dir}`);
    expect(argLists[destroyIdx]).not.toContain("-auto-approve");
  });

  it("uses an existing tfvars when no flags are passed", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "cached"\n');
    expect(() => runDeprovision({ dir })).not.toThrow();
    const destroyCall = mockExec.mock.calls.map((c) => c[1] as string[]).find((a) => a.includes("destroy"));
    expect(destroyCall).toBeDefined();
  });

  it("throws before terraform when no flags and no tfvars exist", () => {
    expect(() => runDeprovision({ dir })).toThrow(/--hosted-zone/);
    const ranTerraform = mockExec.mock.calls.some((c) =>
      (c[1] as string[]).some((a) => a.includes("init") || a.includes("destroy")),
    );
    expect(ranTerraform).toBe(false);
  });

  it("appends -auto-approve when approve is set", () => {
    runDeprovision({ dir, approve: true, flags: FLAGS });
    const destroyCall = mockExec.mock.calls.map((c) => c[1] as string[]).find((a) => a.includes("destroy"));
    expect(destroyCall).toContain("-auto-approve");
  });

  it("fails fast if terraform init fails (destroy never reached)", () => {
    mockExec.mockImplementation((_cmd, args) => {
      if ((args as string[]).includes("init")) throw new Error("terraform init failed");
      return "";
    });
    expect(() => runDeprovision({ dir, flags: FLAGS })).toThrow(/init failed/);
    const reachedDestroy = mockExec.mock.calls.some((c) => (c[1] as string[]).includes("destroy"));
    expect(reachedDestroy).toBe(false);
  });

  it("reports a friendly error when terraform is not installed", () => {
    mockExec.mockImplementation(() => {
      throw Object.assign(new Error("spawnSync terraform ENOENT"), { code: "ENOENT" });
    });
    expect(() => runDeprovision({ dir, flags: FLAGS })).toThrow(/terraform is not installed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/deprovision.test.ts`
Expected: FAIL — `runDeprovision` doesn't accept `flags` / doesn't write tfvars yet.

- [ ] **Step 3: Update `src/commands/deprovision.ts`**

Replace the file with:

```ts
import { terraform } from "../lib/terraform.js";
import { extractTemplates } from "../lib/templates.js";
import { ensureTfvars, type TfvarsFlags } from "../lib/tfvars.js";

/**
 * Tear down the domain (CloudFront) infrastructure via Terraform. Extracts the
 * bundled templates into `dir` when it has no `.tf`, and resolves
 * `terraform.tfvars` the same way as provision (Terraform's no-default
 * variables are required at plan time even for destroy). `terraform destroy`
 * streams its plan and confirmation prompt; pass `approve` for non-interactive
 * `-auto-approve` (e.g. when hostdoc is driven by an agent).
 */
export function runDeprovision(args: {
  dir: string;
  approve?: boolean;
  flags?: TfvarsFlags;
}): void {
  extractTemplates(args.dir);
  ensureTfvars(args.dir, args.flags ?? {});

  // init is always non-interactive; the destroy prompt is the human gate.
  terraform(args.dir, ["init", "-input=false"]);

  const destroyArgs = ["destroy"];
  if (args.approve) destroyArgs.push("-auto-approve");
  terraform(args.dir, destroyArgs);
}
```

- [ ] **Step 4: Add the flags to the `deprovision` command in `src/index.ts`**

Replace the `deprovision` command block with:

```ts
program
  .command("deprovision")
  .description("Tear down the domain infra via Terraform (destroy)")
  .option("--dir <dir>", "Terraform infra directory", "./infra")
  .option("--hosted-zone <zone>", "existing Route53 hosted zone (domain mode)")
  .option("--subdomain <sub>", "subdomain; the site is <subdomain>.<hosted-zone>")
  .option("--region <region>", "AWS region for the S3 bucket (cert is always us-east-1)")
  .option("--price-class <class>", "CloudFront price class (default PriceClass_100)")
  .option("--approve", "auto-approve terraform destroy (non-interactive; for agents/automation)")
  .action((opts) => {
    try {
      runDeprovision({
        dir: opts.dir,
        approve: opts.approve,
        flags: {
          hostedZone: opts.hostedZone,
          subdomain: opts.subdomain,
          region: opts.region,
          priceClass: opts.priceClass,
        },
      });
      console.log(
        "Domain infrastructure destroyed. Run `hostdoc provision` to recreate it.",
      );
    } catch (err) {
      fail(err);
    }
  });
```

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `npx vitest run test/deprovision.test.ts && npm run typecheck`
Expected: PASS — all deprovision tests green; typecheck clean.

- [ ] **Step 6: Verify the CLI exposes the flags**

Run: `npm run dev -- deprovision --help`
Expected: help output lists `--hosted-zone`, `--subdomain`, `--region`, `--price-class`.

- [ ] **Step 7: Commit**

```bash
git add src/commands/deprovision.ts src/index.ts test/deprovision.test.ts
git commit -m "feat: deprovision extracts templates and accepts domain flags (#8)"
```

---

## Task 6: README — npm-only domain-mode flow

**Files:**
- Modify: `README.md` (the "Domain mode" section, ~lines 33–56)

**Interfaces:** none (docs).

- [ ] **Step 1: Update the Domain mode section**

Replace the fenced block and the two lines after it (current lines ~38–56, from `**Prerequisites:**` through the `deprovision` line) with:

```markdown
**Prerequisites:** a Route53 hosted zone for your domain, AWS credentials, and
Terraform installed. No repo checkout needed — the Terraform templates ship
with the npm package and are extracted for you.

```bash
hostdoc provision \
  --hosted-zone example.com \
  --subdomain shared \
  --region us-east-1
# extracts bundled Terraform into ./infra, writes terraform.tfvars from the
# flags, then runs terraform init + apply and saves the config (~15-30 min).
# non-interactive (e.g. driving hostdoc from an agent): add --approve
hostdoc publish ./mydoc      # → https://shared.example.com/<code>/
```

The templates land in `./infra` by default (override with `--dir`). Re-running
`provision` never clobbers an `./infra` you have already edited. Optional
`--price-class` overrides the default `PriceClass_100`.

Already provisioned the infra yourself? Import it without applying:
`hostdoc init --from-terraform ./infra`.

Tear it all down with `hostdoc deprovision` (it reuses the `terraform.tfvars`
written during provision; or pass the same flags). Add `--approve` to run it
non-interactively.
```

- [ ] **Step 2: Verify the doc no longer requires manual file editing**

Run: `grep -n "cd infra\|edit terraform.tfvars\|--hosted-zone" README.md`
Expected: no `cd infra` / `edit terraform.tfvars` lines in the Domain mode flow; `--hosted-zone` now present.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the npm-only domain-mode provision flow (#8)"
```

---

## Final verification

- [ ] **Run the full suite + build + typecheck**

Run: `npm run build && npm run typecheck && npm test`
Expected: build prints `Copied 6 template files...`; typecheck clean; **all** test files pass (including `pack`, `templates`, `tfvars`, rewritten `provision`/`deprovision`).

- [ ] **Confirm the tarball guardrail end-to-end**

Run: `npm pack --dry-run --json --ignore-scripts | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const f=JSON.parse(s)[0].files.map(x=>x.path);console.log('templates:',f.filter(p=>p.includes('templates/infra')).length,'leaks:',f.filter(p=>p.includes('.tfstate')||/(^|\/)terraform\.tfvars$/.test(p)));})"`
Expected: `templates: 6 leaks: []`.

---

## Self-Review (completed during plan authoring)

**Spec coverage:**
- Build-time allowlist copy → Task 1. ✅
- `extractTemplates` / never-clobber → Task 2. ✅
- `writeTfvars` / `ensureTfvars` flags-win precedence → Task 3. ✅
- provision wiring + flags → Task 4. ✅
- deprovision wiring + flags → Task 5. ✅
- tarball guardrail test → Task 1 + Final verification. ✅
- README → Task 6. ✅
- `.terraform.lock.hcl` in allowlist → Tasks 1 & 2 (`TEMPLATE_FILES`). ✅
- Out of scope (guide site #6, `create_publisher_user` flag) → not implemented. ✅

**Type consistency:** `TfvarsFlags` (Task 3) is consumed unchanged by `runProvision`/`runDeprovision` (Tasks 4–5). `TEMPLATE_FILES` is defined in Task 2 and mirrored as a plain array in the build script (Task 1) — intentional (the `.mjs` build script can't import from `dist/`); both lists must stay identical. `extractTemplates(destDir, srcDir?)` signature is identical across tasks.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.
