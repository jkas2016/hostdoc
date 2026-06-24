# tfvars HCL Injection Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop user-supplied tfvars values from being evaluated as HCL templates by writing `terraform.tfvars.json` (JSON-encoded, literal) instead of hand-built HCL.

**Architecture:** Replace the `hcl()` HCL-string builder in `src/lib/tfvars.ts` with `JSON.stringify` to `terraform.tfvars.json` (Terraform auto-loads it, and JSON strings carry no `${}`/`%{}` interpolation). `hasTfvars` detects both the new `.json` and a legacy plain `terraform.tfvars` for back-compat; writing fresh removes the legacy file so "flags win" stays clean. The change is atomic — `tfvars.ts` plus its directly-dependent tests land in one green commit.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Node `node:fs`, Vitest.

## Global Constraints

- **ESM imports** in `.ts` source need a `.js` extension (e.g. `../src/lib/tfvars.js`).
- **No AWS / no Terraform in CI**: tests must not shell out to real terraform (existing tests mock `node:child_process`). Keep it that way.
- **Test/build order**: `pack.test.ts` reads `dist/templates/infra/`, so the full suite is run as `npm run build` then `npm test` (CI parity).
- **Terraform variable file facts** (verified, official docs): Terraform auto-loads `terraform.tfvars.json`; when a var is in both files the `.json` takes precedence (loaded after plain `.tfvars`); `.json` string values are literal (no interpolation).
- Map flag → Terraform variable names exactly: `hosted_zone_name`, `subdomain`, `aws_region`, `price_class`.

---

## File Structure

- `src/lib/tfvars.ts` — **modify**: JSON output, drop `hcl()`, `hasTfvars` dual-detect, legacy removal.
- `test/tfvars.test.ts` — **modify**: JSON assertions + literal-interpolation + legacy back-compat/removal cases.
- `test/provision.test.ts` — **modify**: `.json` path/JSON assertions + legacy-removal assertion.
- `test/deprovision.test.ts` — **modify**: `.json` path/JSON assertion.
- `test/pack.test.ts` — **modify**: extend the "real tfvars" guard regex to cover `.json`.
- `.gitignore` — **modify**: ignore `terraform.tfvars.json`.

---

## Task 1: Emit `terraform.tfvars.json` (literal values), with back-compat

**Files:**
- Modify: `src/lib/tfvars.ts`
- Modify: `.gitignore`
- Test: `test/tfvars.test.ts` (full replace)
- Test: `test/provision.test.ts:1-2,37-39,54-60` and `test/deprovision.test.ts:2,25-27`
- Test: `test/pack.test.ts:33`

**Interfaces:**
- Consumes: nothing new (uses `node:fs` `existsSync`/`writeFileSync`/`rmSync`, `node:path` `join`).
- Produces (public API of `src/lib/tfvars.ts`, signatures unchanged from today):
  - `tfvarsPath(dir: string): string` — now returns `<dir>/terraform.tfvars.json` (the write target).
  - `hasTfvars(dir: string): boolean` — true if `terraform.tfvars.json` **or** legacy `terraform.tfvars` exists.
  - `writeTfvars(dir, { hostedZone, subdomain, region, priceClass? }): void` — writes JSON, removes a legacy plain `terraform.tfvars`.
  - `ensureTfvars(dir, flags: TfvarsFlags): void` — unchanged body; inherits the new filename via the `TFVARS` constant.

- [ ] **Step 1: Replace `test/tfvars.test.ts` with the JSON-contract tests**

Replace the entire file with:

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
  it("emits JSON for the required vars plus price_class", () => {
    writeTfvars(dir, {
      hostedZone: "example.com",
      subdomain: "shared",
      region: "us-east-1",
      priceClass: "PriceClass_100",
    });
    const obj = JSON.parse(readFileSync(tfvarsPath(dir), "utf8"));
    expect(obj).toEqual({
      hosted_zone_name: "example.com",
      subdomain: "shared",
      aws_region: "us-east-1",
      price_class: "PriceClass_100",
    });
  });

  it("omits price_class when not provided", () => {
    writeTfvars(dir, { hostedZone: "a.com", subdomain: "s", region: "r" });
    const obj = JSON.parse(readFileSync(tfvarsPath(dir), "utf8"));
    expect(obj).not.toHaveProperty("price_class");
  });

  it("writes interpolation sequences and quotes literally (no HCL injection)", () => {
    const nasty = '${path.module}%{ for x in y }"\\';
    writeTfvars(dir, { hostedZone: nasty, subdomain: "s", region: "r" });
    const raw = readFileSync(tfvarsPath(dir), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).hosted_zone_name).toBe(nasty);
  });

  it("writes the terraform.tfvars.json filename", () => {
    writeTfvars(dir, { hostedZone: "a.com", subdomain: "s", region: "r" });
    expect(existsSync(join(dir, "terraform.tfvars.json"))).toBe(true);
  });

  it("removes a legacy plain terraform.tfvars when writing fresh", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "old"\n');
    writeTfvars(dir, { hostedZone: "a.com", subdomain: "s", region: "r" });
    expect(existsSync(join(dir, "terraform.tfvars"))).toBe(false);
    expect(existsSync(join(dir, "terraform.tfvars.json"))).toBe(true);
  });
});

describe("ensureTfvars", () => {
  it("writes tfvars when all three required flags are present", () => {
    ensureTfvars(dir, { hostedZone: "example.com", subdomain: "shared", region: "us-east-1" });
    const obj = JSON.parse(readFileSync(tfvarsPath(dir), "utf8"));
    expect(obj.subdomain).toBe("shared");
  });

  it("overwrites an existing tfvars (flags win)", () => {
    writeFileSync(tfvarsPath(dir), '{ "subdomain": "old" }\n');
    ensureTfvars(dir, { hostedZone: "new.com", subdomain: "fresh", region: "r" });
    const obj = JSON.parse(readFileSync(tfvarsPath(dir), "utf8"));
    expect(obj.subdomain).toBe("fresh");
  });

  it("throws naming the missing flag when only some required flags are given", () => {
    expect(() => ensureTfvars(dir, { hostedZone: "example.com" })).toThrow(/--subdomain.*--region|--region.*--subdomain/);
  });

  it("uses an existing tfvars.json when no flags are given", () => {
    writeFileSync(tfvarsPath(dir), '{ "subdomain": "cached" }\n');
    expect(() => ensureTfvars(dir, {})).not.toThrow();
    expect(readFileSync(tfvarsPath(dir), "utf8")).toBe('{ "subdomain": "cached" }\n');
  });

  it("uses an existing legacy terraform.tfvars when no flags are given (back-compat)", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "cached"\n');
    expect(() => ensureTfvars(dir, {})).not.toThrow();
    expect(readFileSync(join(dir, "terraform.tfvars"), "utf8")).toBe('subdomain = "cached"\n');
  });

  it("throws when no flags and no tfvars exist", () => {
    expect(() => ensureTfvars(dir, {})).toThrow(/--hosted-zone/);
    expect(existsSync(tfvarsPath(dir))).toBe(false);
    expect(existsSync(join(dir, "terraform.tfvars"))).toBe(false);
  });
});
```

- [ ] **Step 2: Update `test/provision.test.ts`**

Add `existsSync` to the `node:fs` import (line 2):

```ts
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
```

Replace the assertion in the "writes tfvars from flags…" test (currently lines 37-39):

```ts
    expect(
      JSON.parse(readFileSync(join(dir, "terraform.tfvars.json"), "utf8")).hosted_zone_name,
    ).toBe("example.com");
```

Replace the whole "lets flags overwrite an existing tfvars" test (currently lines 54-60):

```ts
  it("lets flags overwrite an existing tfvars (and removes the legacy file)", () => {
    writeFileSync(join(dir, "terraform.tfvars"), 'subdomain = "old"\n');
    runProvision({ dir, flags: { ...FLAGS, subdomain: "fresh" } });
    expect(
      JSON.parse(readFileSync(join(dir, "terraform.tfvars.json"), "utf8")).subdomain,
    ).toBe("fresh");
    expect(existsSync(join(dir, "terraform.tfvars"))).toBe(false);
  });
```

Leave the "uses an existing tfvars when no flags are passed" test (lines 62-66) **unchanged** — it seeds a legacy `terraform.tfvars` and is the command-level back-compat guard.

- [ ] **Step 3: Update `test/deprovision.test.ts`**

Add `existsSync` to the `node:fs` import (line 2):

```ts
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
```

Replace the assertion in the "writes tfvars from flags…" test (currently lines 25-27):

```ts
    expect(
      JSON.parse(readFileSync(join(dir, "terraform.tfvars.json"), "utf8")).aws_region,
    ).toBe("ap-northeast-2");
```

Leave the "uses an existing tfvars when no flags are passed" test (lines 37-42) **unchanged** (legacy back-compat guard).

- [ ] **Step 4: Update `test/pack.test.ts` guard regex**

Replace line 33:

```ts
    expect(files.some((p) => /(^|\/)terraform\.tfvars(\.json)?$/.test(p))).toBe(false);
```

- [ ] **Step 5: Run the suite to verify the new/updated tests FAIL**

Run: `npm run build && npx vitest run test/tfvars.test.ts test/provision.test.ts test/deprovision.test.ts test/pack.test.ts`
Expected: FAIL — `tfvars.ts` still emits HCL to `terraform.tfvars`, so JSON.parse / `.json`-path reads error and the new assertions fail. (`pack.test.ts` should still pass — the regex change is a no-op for current shipped files.)

- [ ] **Step 6: Rewrite `src/lib/tfvars.ts`**

Replace lines 1-41 (imports through the end of `writeTfvars`) with:

```ts
import { existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface TfvarsFlags {
  hostedZone?: string;
  subdomain?: string;
  region?: string;
  priceClass?: string;
}

const TFVARS = "terraform.tfvars.json";
const LEGACY_TFVARS = "terraform.tfvars";

export function tfvarsPath(dir: string): string {
  return join(dir, TFVARS);
}

/** True if a tool-written terraform.tfvars.json or a legacy terraform.tfvars exists. */
export function hasTfvars(dir: string): boolean {
  return existsSync(tfvarsPath(dir)) || existsSync(join(dir, LEGACY_TFVARS));
}

/**
 * Write terraform.tfvars.json in <dir>. Values are JSON-encoded, so user input is
 * always literal — JSON has no HCL template interpolation, closing the
 * ${...}/%{...} injection vector. price_class is only emitted when provided
 * (Terraform supplies its own default otherwise). A legacy plain terraform.tfvars
 * is removed so flags win cleanly (Terraform would otherwise still load it, with
 * terraform.tfvars.json taking precedence per-key but leaving stale keys behind).
 */
export function writeTfvars(
  dir: string,
  vars: { hostedZone: string; subdomain: string; region: string; priceClass?: string },
): void {
  const obj: Record<string, string> = {
    hosted_zone_name: vars.hostedZone,
    subdomain: vars.subdomain,
    aws_region: vars.region,
  };
  if (vars.priceClass) obj.price_class = vars.priceClass;
  writeFileSync(tfvarsPath(dir), JSON.stringify(obj, null, 2) + "\n");
  rmSync(join(dir, LEGACY_TFVARS), { force: true });
}
```

Leave `ensureTfvars` (the rest of the file) unchanged — its `${TFVARS}` reference now resolves to the new filename automatically.

- [ ] **Step 7: Run the targeted suite to verify it PASSES**

Run: `npm run build && npx vitest run test/tfvars.test.ts test/provision.test.ts test/deprovision.test.ts test/pack.test.ts`
Expected: PASS (all files green).

- [ ] **Step 8: Ignore the generated JSON tfvars in `.gitignore`**

After the existing `terraform.tfvars` line (line 10), add:

```
terraform.tfvars.json
```

(The existing `terraform.tfvars` glob does not match the `.json` variant.)

- [ ] **Step 9: Full CI-parity verification**

Run: `npm run build && npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS (112 baseline + the change; count may shift with the new/removed test cases — 0 failures is the gate).

- [ ] **Step 10: Commit**

```bash
git add src/lib/tfvars.ts .gitignore test/tfvars.test.ts test/provision.test.ts test/deprovision.test.ts test/pack.test.ts
git commit -m "fix: write terraform.tfvars.json to prevent HCL template injection

User-supplied zone/subdomain/region flags were interpolated into HCL string
literals; ${...}/%{...} sequences were evaluated by Terraform. Emit JSON
instead (literal values, auto-loaded by Terraform). hasTfvars also detects a
legacy terraform.tfvars for back-compat; writing fresh removes it.

Closes #16

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Emit JSON via `JSON.stringify` → Step 6. ✓
- `hcl()` removed → Step 6 (not present in replacement). ✓
- `hasTfvars` detects both → Step 6 + tests Step 1 (`.json` + legacy cases). ✓
- Legacy removal on fresh write → Step 6 + tests Step 1/Step 2. ✓
- `.gitignore` entry → Step 8. ✓
- `terraform.tfvars.example` unchanged → not modified (correct). ✓
- Test plan: interpolation-literal (Step 1), JSON parse (Step 1), price_class optional (Step 1), legacy compat (Step 1 unit + Step 2/3 command-level), provision/deprovision/pack updates (Steps 2-4). ✓
- Acceptance criterion 1 (interpolation written safely, test added) → Step 1 "writes interpolation sequences…literally". ✓
- Acceptance criterion 2 (parses in Terraform) → JSON.parse round-trip is the offline proxy; JSON validity is the Terraform-parse guarantee per verified docs. ✓

**2. Placeholder scan:** No TBD/TODO/"add error handling"/vague steps; every code step shows full code. ✓

**3. Type consistency:** `tfvarsPath`/`hasTfvars`/`writeTfvars`/`ensureTfvars` signatures match the existing public API and the test imports (`writeTfvars, ensureTfvars, tfvarsPath`). Variable keys (`hosted_zone_name`, `subdomain`, `aws_region`, `price_class`) match `infra/variables.tf`. `rmSync(..., { force: true })` no-ops on a missing path (Node ≥22). ✓
