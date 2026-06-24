# Spec: Fix tfvars HCL injection (escape interpolation by emitting JSON)

- **Issue**: [#16](https://github.com/jkas2016/hostdoc/issues/16)
- **Date**: 2026-06-24
- **Source**: `deep-code-review` (2026-06-23)

## Problem

`src/lib/tfvars.ts` writes `terraform.tfvars` by interpolating user-supplied
values (`hostedZone` / `subdomain` / `region` / `priceClass` — unvalidated CLI
flags) into HCL string literals via `hcl()`:

```ts
function hcl(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
```

`hcl()` escapes only `\` and `"`. It does **not** escape HCL **template
interpolation/directive** sequences `${...}` and `%{...}`. When Terraform parses
an HCL `.tfvars` file, a double-quoted string is a template, so a value such as
`${path.module}` is evaluated as an expression, and an unbalanced `${` is a
parse error. This is an injection / robustness defect: attacker- or
mistake-supplied flag values change or break Terraform parsing.

## Goal

User values are always written **literally** to the Terraform variable file, with
no interpolation or directive evaluation, and the generated file parses cleanly
in Terraform.

## Approach (decided)

**Emit `terraform.tfvars.json` via `JSON.stringify` instead of hand-built HCL.**

Rationale (chosen over "escape `$${`/`%%{` in `hcl()`"):

- JSON variable files have **no template semantics** — string values are always
  literal, so the entire injection class is removed at the source rather than
  patched with fragile escaping rules.
- It **removes** code (`hcl()` and its escaping) instead of adding more.

Verified against official Terraform docs
(<https://developer.hashicorp.com/terraform/language/values/variables>):

- Terraform **automatically loads** a file named `terraform.tfvars.json`.
- When the same variable is defined in both, `terraform.tfvars.json` is loaded
  **after** (takes precedence over) plain `terraform.tfvars`.
- `.json` files are parsed as a JSON object (variable names as keys); JSON
  strings carry no interpolation meaning.

## Changes

### 1. `src/lib/tfvars.ts` (core)

- `TFVARS = "terraform.tfvars.json"`; delete `hcl()`.
- `writeTfvars`: build an object and write
  `JSON.stringify(obj, null, 2) + "\n"`. Keys map to the Terraform variables:
  `hosted_zone_name`, `subdomain`, `aws_region`, and `price_class` (the last
  included only when `priceClass` is provided, preserving "Terraform supplies its
  own default otherwise").
- `writeTfvars`: when writing a fresh file from flags, **remove a legacy plain
  `terraform.tfvars`** if present. This keeps "flags win" clean — otherwise a
  stale HCL file lingers and Terraform still loads it (e.g. its `price_class`
  would survive even when new flags omit it).
- `hasTfvars`: detect **both** the new `terraform.tfvars.json` **and** legacy
  `terraform.tfvars`. Backward compatibility: users who provisioned with
  ≤1.1.0 have a plain `terraform.tfvars`; no-flag `deprovision` must still find
  it and Terraform still loads it.
- `tfvarsPath` keeps returning the **write target** (now `.json`).

### 2. `.gitignore`

- Add `terraform.tfvars.json`. The existing `terraform.tfvars` glob does not
  match the `.json` variant, so the generated file must be ignored explicitly to
  avoid committing user infra values.

### 3. `infra/terraform.tfvars.example` — unchanged

It is documentation for hand-authoring; a hand-written HCL `terraform.tfvars` is
still detected by `hasTfvars` and loaded by Terraform.

## Test plan (TDD: tests first)

### `test/tfvars.test.ts`

- Replace the HCL-escaping assertion with a JSON-shape assertion.
- **New**: a value containing `${path.module}`, `%{ for x in y }`, `"` and `\`
  is written **literally** (round-trip via `JSON.parse` returns the exact input).
  → issue acceptance criterion 1.
- **New**: generated file is valid JSON / parses (`JSON.parse` succeeds, keys and
  values match). → issue acceptance criterion 2.
- **New**: `price_class` key is present only when `priceClass` is passed.
- **New (compat)**: with only a legacy `terraform.tfvars` present, `hasTfvars`
  is `true` and no-flag `ensureTfvars` does not throw.
- **New (flags win)**: writing fresh from flags removes a pre-existing legacy
  `terraform.tfvars`.

### `test/provision.test.ts` · `test/deprovision.test.ts`

- Update hardcoded `terraform.tfvars` paths/content to the `.json` file and JSON
  assertions (these read the generated file directly).

### `test/pack.test.ts`

- Extend the "never ships state or real tfvars" guard regex to
  `terraform\.tfvars(\.json)?$` so the JSON variant is also covered.

## Acceptance criteria (from issue)

- [ ] Values containing interpolation sequences (`${`, `%{`) are written safely
      as literals (test added).
- [ ] The generated tfvars parses correctly in Terraform.

## Non-goals

- Validating the semantic content of zone/subdomain/region flags (out of scope;
  this fix is about safe serialization).
- Changing `infra/` Terraform or the variable schema.

## References

- Variable definitions: `infra/variables.tf`
- Mode/provisioning rules: `CLAUDE.md` (Architecture)
- Terraform variables (auto-load + JSON): see official doc link above
