# Phase 2 — 도메인/HTTPS 모드 (CloudFront + ACM + Route53) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hostdoc의 `cloudfront` 모드 런타임 경로(무효화, `init --from-terraform`)를 완성하고, CloudFront + ACM(us-east-1) + Route53 + 비공개 S3(OAC)를 Terraform `infra/` 모듈로 프로비저닝한다. (이슈 #1)

**Architecture:** 업로드 로직은 모드 공통. Mode A가 추가하는 것은 (a) Terraform 프로비저닝, (b) CloudFront `/<code>/*` 무효화 단계, (c) `init --from-terraform`뿐. 하위경로 인덱스와 `_meta/` 보호는 CloudFront viewer-request Function이 담당. ACM은 CloudFront 요건상 us-east-1 provider alias로 발급하고 Route53 DNS 검증을 자동화.

**Tech Stack:** TypeScript, `@aws-sdk/client-cloudfront`, commander, vitest + aws-sdk-client-mock, Terraform(AWS provider), CloudFront Functions(`cloudfront-js-2.0`).

## Global Constraints

- 자격 증명은 코드에 두지 않고 SDK 기본 체인에 위임(`--profile`/`AWS_PROFILE`). `makeCloudFront`는 `makeS3`와 동일 패턴.
- CloudFront 클라이언트 region은 **`us-east-1`**(CloudFront는 글로벌 엔드포인트).
- 무효화 경로는 항상 `"/<code>/*"` 형식.
- **terraform은 CI에서 실행하지 않는다**(로컬 전용). 검증은 로컬 `terraform fmt -check`/`validate`/`apply`.
- 기존 s3-website 동작/테스트를 깨지 않는다(모든 분기는 `cfg.mode === "cloudfront"` 가드).
- TDD: 각 코드 Task는 실패 테스트 → 구현 → 통과 → 커밋.
- `config.ts`의 `Config`/`resolveConfig`의 cloudfront 분기, `url.ts`의 `buildPublicUrl` cloudfront 분기는 **이미 존재**한다(재구현 금지, 소비만).

---

### Task 1: CloudFront 무효화 라이브러리 (`lib/cloudfront.ts`)

**Files:**
- Modify: `package.json` (dependency 추가)
- Create: `src/lib/cloudfront.ts`
- Test: `test/cloudfront.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `makeCloudFront(opts: { profile?: string }): CloudFrontClient`
  - `invalidate(cf: CloudFrontClient, distributionId: string, paths: string[], opts?: { maxRetries?: number; baseDelayMs?: number }): Promise<void>`

- [ ] **Step 1: `@aws-sdk/client-cloudfront` 설치 (기존 v3 라인과 정렬)**

Run:
```bash
npm install @aws-sdk/client-cloudfront
```
Expected: `dependencies`에 `@aws-sdk/client-cloudfront` 추가(3.x).

- [ ] **Step 2: 실패 테스트 작성**

Create `test/cloudfront.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { makeCloudFront, invalidate } from "../src/lib/cloudfront.js";

const cfMock = mockClient(CloudFrontClient);
beforeEach(() => cfMock.reset());

describe("invalidate", () => {
  it("creates an invalidation for the given paths", async () => {
    cfMock.on(CreateInvalidationCommand).resolves({});
    const cf = makeCloudFront({});
    await invalidate(cf, "DIST123", ["/abc/*"]);

    const input = cfMock.commandCalls(CreateInvalidationCommand)[0].args[0].input;
    expect(input.DistributionId).toBe("DIST123");
    expect(input.InvalidationBatch?.Paths?.Items).toEqual(["/abc/*"]);
    expect(input.InvalidationBatch?.Paths?.Quantity).toBe(1);
  });

  it("retries on throttling then succeeds", async () => {
    const err = Object.assign(new Error("rate"), {
      name: "TooManyInvalidationsInProgress",
    });
    cfMock.on(CreateInvalidationCommand).rejectsOnce(err).resolves({});
    const cf = makeCloudFront({});
    await invalidate(cf, "DIST123", ["/abc/*"], { baseDelayMs: 0 });
    expect(cfMock.commandCalls(CreateInvalidationCommand)).toHaveLength(2);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run test/cloudfront.test.ts`
Expected: FAIL — `makeCloudFront`/`invalidate` 모듈 없음.

- [ ] **Step 4: 구현 작성**

Create `src/lib/cloudfront.ts`:

```ts
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

// CloudFront is a global service reached through the us-east-1 endpoint.
export function makeCloudFront(opts: { profile?: string }): CloudFrontClient {
  return new CloudFrontClient({
    region: "us-east-1",
    credentials: opts.profile
      ? fromNodeProviderChain({ profile: opts.profile })
      : undefined,
  });
}

const THROTTLE_NAMES = new Set([
  "Throttling",
  "ThrottlingException",
  "TooManyInvalidationsInProgress",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function invalidate(
  cf: CloudFrontClient,
  distributionId: string,
  paths: string[],
  opts: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<void> {
  const maxRetries = opts.maxRetries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  for (let attempt = 0; ; attempt++) {
    try {
      await cf.send(
        new CreateInvalidationCommand({
          DistributionId: distributionId,
          InvalidationBatch: {
            CallerReference: `hostdoc-${Date.now()}-${attempt}`,
            Paths: { Quantity: paths.length, Items: paths },
          },
        }),
      );
      return;
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      if (!THROTTLE_NAMES.has(name) || attempt >= maxRetries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run test/cloudfront.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/cloudfront.ts test/cloudfront.test.ts
git commit -m "feat: CloudFront invalidation helper with throttle backoff"
```

---

### Task 2: 무효화 배선 (`publish` 덮어쓰기 + `rm`)

**Files:**
- Modify: `src/commands/publish.ts`
- Modify: `src/commands/rm.ts`
- Test: `test/publish.test.ts` (추가), `test/rm.test.ts` (추가)

**Interfaces:**
- Consumes: `makeCloudFront`, `invalidate` (Task 1)
- Produces: 없음(커맨드 부수효과)

- [ ] **Step 1: publish 무효화 실패 테스트 추가**

`test/publish.test.ts`에 다음 import와 테스트를 추가한다. 파일 상단 import 블록에 CloudFront mock을 더한다:

```ts
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
```

`s3mock` 선언 아래에 추가:
```ts
const cfMock = mockClient(CloudFrontClient);
```
`beforeEach`의 `s3mock.reset()` 옆에 `cfMock.reset();`와 `cfMock.on(CreateInvalidationCommand).resolves({});`를 추가한다.

`describe("runPublish", ...)` 안에 새 테스트 추가:
```ts
  it("invalidates /<code>/* when overwriting in cloudfront mode", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    s3mock.on(ListObjectsV2Command).resolves({
      KeyCount: 1,
      Contents: [{ Key: "doc1/index.html" }],
      IsTruncated: false,
    });
    writeFileSync(join(dir, "index.html"), "x");

    await runPublish({ path: dir, slug: "doc1", force: true });

    const calls = cfMock.commandCalls(CreateInvalidationCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.InvalidationBatch?.Paths?.Items).toEqual([
      "/doc1/*",
    ]);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });

  it("does not invalidate on a fresh publish (no overwrite)", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    writeFileSync(join(dir, "index.html"), "x");

    await runPublish({ path: dir, slug: "fresh1" });

    expect(cfMock.commandCalls(CreateInvalidationCommand)).toHaveLength(0);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/publish.test.ts`
Expected: 새 "invalidates" 테스트 FAIL(무효화 미호출).

- [ ] **Step 3: publish 구현 수정**

`src/commands/publish.ts`에서:

import 추가:
```ts
import { makeCloudFront, invalidate } from "../lib/cloudfront.js";
```

`--force` 삭제 블록을 overwrite 추적으로 변경:
```ts
  let overwritten = false;
  if (args.force) {
    const existing = await listKeys(s3, cfg.bucket, `${code}/`);
    if (existing.length) {
      await deleteKeys(s3, cfg.bucket, existing);
      overwritten = true;
    }
  }
```

`return buildPublicUrl(cfg, code);` 직전에 추가:
```ts
  if (cfg.mode === "cloudfront" && cfg.distributionId && overwritten) {
    const cf = makeCloudFront({ profile: args.profile });
    await invalidate(cf, cfg.distributionId, [`/${code}/*`]);
  }
```

- [ ] **Step 4: publish 테스트 통과 확인**

Run: `npx vitest run test/publish.test.ts`
Expected: PASS(기존 + 새 2 테스트).

- [ ] **Step 5: rm 무효화 실패 테스트 추가**

`test/rm.test.ts` 상단 import에 추가:
```ts
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
```
`s3mock` 아래에 `const cfMock = mockClient(CloudFrontClient);` 추가, `beforeEach`에 `cfMock.reset();`와 `cfMock.on(CreateInvalidationCommand).resolves({});` 추가.

`describe("runRm", ...)` 안에 추가:
```ts
  it("invalidates /<id>/* in cloudfront mode", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    s3mock
      .on(ListObjectsV2Command)
      .resolves({ Contents: [{ Key: "doc1/index.html" }], IsTruncated: false });
    s3mock.on(DeleteObjectsCommand).resolves({});

    await runRm({ id: "doc1", yes: true });

    const calls = cfMock.commandCalls(CreateInvalidationCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.InvalidationBatch?.Paths?.Items).toEqual([
      "/doc1/*",
    ]);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npx vitest run test/rm.test.ts`
Expected: 새 테스트 FAIL.

- [ ] **Step 7: rm 구현 수정**

`src/commands/rm.ts`에서 import 추가:
```ts
import { makeCloudFront, invalidate } from "../lib/cloudfront.js";
```
`// Phase 2 (cloudfront mode): invalidate /<id>/* here.` 주석을 다음으로 교체:
```ts
  if (cfg.mode === "cloudfront" && cfg.distributionId) {
    const cf = makeCloudFront({ profile: args.profile });
    await invalidate(cf, cfg.distributionId, [`/${args.id}/*`]);
  }
```

- [ ] **Step 8: 전체 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS(s3-website 회귀 없음 — 기존 테스트는 cloudfront env가 없어 무효화 분기 미진입).

- [ ] **Step 9: Commit**

```bash
git add src/commands/publish.ts src/commands/rm.ts test/publish.test.ts test/rm.test.ts
git commit -m "feat: wire CloudFront invalidation into publish (overwrite) and rm"
```

---

### Task 3: `init --from-terraform <dir>` 명령

**Files:**
- Create: `src/commands/init.ts`
- Modify: `src/index.ts` (서브커맨드 배선)
- Test: `test/init.test.ts`

**Interfaces:**
- Consumes: `saveConfig`, `Config` (`lib/config.ts`)
- Produces:
  - `readTerraformOutputs(dir: string): Record<string, { value: unknown }>`
  - `runInit(args: { dir: string }): Config`

- [ ] **Step 1: 실패 테스트 작성**

Create `test/init.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { runInit } from "../src/commands/init.js";
import { loadConfig } from "../src/lib/config.js";

const mockExec = vi.mocked(execFileSync);

const FIXTURE = JSON.stringify({
  bucket_name: { value: "shared.example.com", type: "string" },
  region: { value: "us-east-1", type: "string" },
  distribution_id: { value: "E123ABC", type: "string" },
  site_domain: { value: "shared.example.com", type: "string" },
});

beforeEach(() => mockExec.mockReset());

describe("runInit", () => {
  it("writes a cloudfront config from terraform outputs", () => {
    mockExec.mockReturnValue(FIXTURE);
    const cfg = runInit({ dir: "./infra" });

    expect(cfg).toEqual({
      mode: "cloudfront",
      bucket: "shared.example.com",
      region: "us-east-1",
      distributionId: "E123ABC",
      domain: "shared.example.com",
    });
    expect(loadConfig()).toEqual(cfg);
    expect(mockExec).toHaveBeenCalledWith(
      "terraform",
      ["-chdir=./infra", "output", "-json"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("throws a helpful error when terraform is unavailable", () => {
    mockExec.mockImplementation(() => {
      throw Object.assign(new Error("spawn terraform ENOENT"), { code: "ENOENT" });
    });
    expect(() => runInit({ dir: "./infra" })).toThrow(/terraform/i);
  });

  it("throws when a required output is missing", () => {
    mockExec.mockReturnValue(JSON.stringify({ region: { value: "us-east-1" } }));
    expect(() => runInit({ dir: "./infra" })).toThrow(/bucket_name/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/init.test.ts`
Expected: FAIL — `runInit` 모듈 없음.

- [ ] **Step 3: 구현 작성**

Create `src/commands/init.ts`:

```ts
import { execFileSync } from "node:child_process";
import { saveConfig, type Config } from "../lib/config.js";

interface TfOutput {
  value: unknown;
}

export function readTerraformOutputs(dir: string): Record<string, TfOutput> {
  const raw = execFileSync("terraform", [`-chdir=${dir}`, "output", "-json"], {
    encoding: "utf8",
  });
  return JSON.parse(raw) as Record<string, TfOutput>;
}

export function runInit(args: { dir: string }): Config {
  let outputs: Record<string, TfOutput>;
  try {
    outputs = readTerraformOutputs(args.dir);
  } catch (err) {
    throw new Error(
      `Could not read terraform outputs from "${args.dir}". ` +
        `Ensure terraform is installed and \`terraform apply\` has run there. ` +
        `(${(err as Error).message})`,
    );
  }

  const get = (key: string): string => {
    const v = outputs[key]?.value;
    if (typeof v !== "string" || !v) {
      throw new Error(`Missing terraform output: ${key}`);
    }
    return v;
  };

  const cfg: Config = {
    mode: "cloudfront",
    bucket: get("bucket_name"),
    region: get("region"),
    distributionId: get("distribution_id"),
    domain: get("site_domain"),
  };
  saveConfig(cfg);
  return cfg;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/init.test.ts`
Expected: PASS(3 tests).

- [ ] **Step 5: `init` 서브커맨드 배선**

`src/index.ts`에서 import 추가(다른 command import 옆):
```ts
import { runInit } from "./commands/init.js";
```
`program.command("setup")` 블록 뒤에 추가:
```ts
program
  .command("init")
  .description("Import domain (Terraform) infra outputs and write a cloudfront config")
  .requiredOption("--from-terraform <dir>", "path to the Terraform infra directory")
  .action((opts) => {
    try {
      const cfg = runInit({ dir: opts.fromTerraform });
      console.log(
        `Wrote cloudfront config for ${cfg.domain} (distribution ${cfg.distributionId}).`,
      );
    } catch (err) {
      fail(err);
    }
  });
```

- [ ] **Step 6: 빌드 + 전체 테스트 확인**

Run: `npm run build && npm test`
Expected: 빌드 성공, 전체 테스트 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/commands/init.ts src/index.ts test/init.test.ts
git commit -m "feat: add `init --from-terraform` to import cloudfront config"
```

---

### Task 4: CloudFront Function `index-rewrite.js`

**Files:**
- Create: `infra/index-rewrite.js`
- Test: `test/index-rewrite.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `infra/index-rewrite.js`(Task 5의 `aws_cloudfront_function`이 `file()`로 로드)

- [ ] **Step 1: 실패 테스트 작성**

Create `test/index-rewrite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// CloudFront Function files have no module exports; load the source into a
// sandbox and expose its `handler` for testing the pure URI-rewrite logic.
function loadHandler(): (event: unknown) => any {
  const code = readFileSync("infra/index-rewrite.js", "utf8");
  const sandbox: { handler?: (event: unknown) => any } = {};
  vm.createContext(sandbox);
  vm.runInContext(`${code}\nthis.handler = handler;`, sandbox);
  return sandbox.handler!;
}

const handler = loadHandler();
const reqEvent = (uri: string) => ({ request: { uri, headers: {} } });

describe("index-rewrite handler", () => {
  it("appends index.html for a trailing-slash URI", () => {
    const out = handler(reqEvent("/x7Kq2a/"));
    expect(out.uri).toBe("/x7Kq2a/index.html");
  });

  it("appends /index.html for an extensionless URI", () => {
    const out = handler(reqEvent("/x7Kq2a"));
    expect(out.uri).toBe("/x7Kq2a/index.html");
  });

  it("leaves a file URI with an extension untouched", () => {
    const out = handler(reqEvent("/x7Kq2a/assets/app.js"));
    expect(out.uri).toBe("/x7Kq2a/assets/app.js");
  });

  it("returns 403 for an underscore-prefixed path (meta protection)", () => {
    const out = handler(reqEvent("/_meta/x7Kq2a.json"));
    expect(out.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/index-rewrite.test.ts`
Expected: FAIL — `infra/index-rewrite.js` 없음.

- [ ] **Step 3: 구현 작성**

Create `infra/index-rewrite.js`:

```js
// CloudFront Function (runtime: cloudfront-js-2.0), viewer-request.
// - Protect the private `_meta/` prefix: any "/_*" path returns 403.
// - Subdirectory index: CloudFront's Default Root Object applies only to "/",
//   so append "index.html" for trailing-slash or extensionless URIs.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.indexOf("/_") === 0) {
    return { statusCode: 403, statusDescription: "Forbidden" };
  }

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else {
    var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
    if (lastSegment.indexOf(".") === -1) {
      request.uri = uri + "/index.html";
    }
  }

  return request;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/index-rewrite.test.ts`
Expected: PASS(4 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/index-rewrite.js test/index-rewrite.test.ts
git commit -m "feat: CloudFront Function for subdir index + /_* 403"
```

---

### Task 5: Terraform 모듈 `infra/`

**Files:**
- Create: `infra/variables.tf`, `infra/main.tf`, `infra/outputs.tf`, `infra/terraform.tfvars.example`

**Interfaces:**
- Consumes: `infra/index-rewrite.js` (Task 4)
- Produces: outputs `bucket_name`/`region`/`distribution_id`/`site_domain`/`publisher_policy_json`(Task 3의 `runInit`이 소비)

> **검증 메모:** terraform이 미설치일 수 있다. Step 1에서 설치한다. HCL 인수명은 AWS provider 문서 기준으로 작성했으나, `terraform validate`(Step 6)가 최종 진실이다. validate가 인수명/필수값을 잡으면 provider 문서( https://registry.terraform.io/providers/hashicorp/aws/latest/docs )를 참조해 고친다 — 추측하지 말 것.

- [ ] **Step 1: terraform 설치 + 디렉터리 준비**

Run:
```bash
terraform version || brew install terraform
mkdir -p infra
```
Expected: `terraform version`이 버전 출력(미설치면 brew 설치 후 재실행).

- [ ] **Step 2: `infra/variables.tf` 작성**

```hcl
variable "hosted_zone_name" {
  type        = string
  description = "Existing Route53 hosted zone (looked up via data source)."
}

variable "subdomain" {
  type        = string
  description = "Subdomain; the site is <subdomain>.<hosted_zone_name>."
}

variable "aws_region" {
  type        = string
  description = "Region for the S3 bucket (the ACM cert is always us-east-1)."
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "create_publisher_user" {
  type    = bool
  default = false
}
```

- [ ] **Step 3: `infra/main.tf` 작성**

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ACM for CloudFront must be in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  site_domain = "${var.subdomain}.${var.hosted_zone_name}"
  bucket_name = local.site_domain
}

data "aws_route53_zone" "this" {
  name = var.hosted_zone_name
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# --- Private S3 bucket (OAC origin) ---
resource "aws_s3_bucket" "site" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${local.bucket_name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# --- CloudFront Function (viewer-request) ---
resource "aws_cloudfront_function" "index_rewrite" {
  name    = "${replace(local.site_domain, ".", "-")}-index-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/index-rewrite.js")
}

# --- ACM certificate (us-east-1) + Route53 DNS validation ---
resource "aws_acm_certificate" "site" {
  provider          = aws.us_east_1
  domain_name       = local.site_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.site.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id         = data.aws_route53_zone.this.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# --- CloudFront distribution ---
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = [local.site_domain]
  price_class         = var.price_class

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.site.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-${aws_s3_bucket.site.id}"
    viewer_protocol_policy  = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

# --- Bucket policy scoped to this distribution (OAC) ---
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn }
      }
    }]
  })
}

# --- Route53 alias records → distribution ---
resource "aws_route53_record" "alias_a" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = local.site_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_aaaa" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = local.site_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

# --- Optional dedicated publisher IAM user ---
resource "aws_iam_user" "publisher" {
  count = var.create_publisher_user ? 1 : 0
  name  = "${replace(local.site_domain, ".", "-")}-publisher"
}

resource "aws_iam_access_key" "publisher" {
  count = var.create_publisher_user ? 1 : 0
  user  = aws_iam_user.publisher[0].name
}

resource "aws_iam_user_policy" "publisher" {
  count  = var.create_publisher_user ? 1 : 0
  name   = "hostdoc-publish"
  user   = aws_iam_user.publisher[0].name
  policy = local.publisher_policy_json
}
```

- [ ] **Step 4: `infra/outputs.tf` 작성**

```hcl
locals {
  publisher_policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Objects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.site.arn}/*"
      },
      {
        Sid      = "ListBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.site.arn
      },
      {
        Sid      = "Invalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.site.arn
      }
    ]
  })
}

output "bucket_name" {
  value = aws_s3_bucket.site.id
}

output "region" {
  value = var.aws_region
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "site_domain" {
  value = local.site_domain
}

output "publisher_policy_json" {
  value = local.publisher_policy_json
}

output "publisher_access_key_id" {
  value     = var.create_publisher_user ? aws_iam_access_key.publisher[0].id : null
  sensitive = true
}

output "publisher_secret_access_key" {
  value     = var.create_publisher_user ? aws_iam_access_key.publisher[0].secret : null
  sensitive = true
}
```

- [ ] **Step 5: `infra/terraform.tfvars.example` 작성**

```hcl
hosted_zone_name = "example.com"     # existing Route53 hosted zone
subdomain        = "shared"          # → shared.example.com
aws_region       = "us-east-1"       # bucket region (cert is always us-east-1)
price_class      = "PriceClass_100"  # cheapest CloudFront tier
```

- [ ] **Step 6: fmt + init + validate**

Run:
```bash
cd infra && terraform fmt -check && terraform init -backend=false && terraform validate; cd ..
```
Expected: `fmt -check` 차이 없음, `validate`가 `Success! The configuration is valid.` 출력. 인수명/필수값 에러가 나면 위 검증 메모대로 provider 문서로 수정 후 재실행(추측 금지, 막히면 3회 후 보고).

- [ ] **Step 7: Commit**

```bash
git add infra/variables.tf infra/main.tf infra/outputs.tf infra/terraform.tfvars.example
git commit -m "feat: Terraform module for CloudFront/ACM/Route53 domain mode"
```

---

### Task 6: README 도메인 모드 섹션

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: README에 도메인 모드 + 외부 DNS 폴백 섹션 추가**

`README.md`에 다음 섹션을 추가한다(기존 무도메인 섹션 뒤):

````markdown
## Domain mode (HTTPS via CloudFront)

Domain mode serves your docs over HTTPS from a fully private S3 bucket fronted
by CloudFront (OAC). It is provisioned with Terraform.

**Prerequisites:** a Route53 hosted zone for your domain, AWS credentials, and
Terraform installed.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: hosted_zone_name, subdomain, aws_region
terraform init
terraform apply            # CloudFront + ACM validation take ~15-30 min
cd ..

hostdoc init --from-terraform ./infra   # writes a cloudfront config
hostdoc publish ./mydoc                  # → https://<subdomain>.<domain>/<code>/
```

Overwriting (`--force`) and `hostdoc rm` automatically invalidate
`/<code>/*` on the distribution.

### External (non-Route53) DNS

Automated ACM validation and alias records require a Route53 hosted zone. If
your domain is hosted elsewhere (e.g. Cloudflare), provisioning is manual:
add the ACM validation CNAME shown by AWS, then point your subdomain at the
CloudFront distribution domain via a CNAME/ALIAS record. This is outside the
automated path.

### Security note

The Terraform `publisher_policy_json` output is a minimal IAM policy for
publishing. Prefer a dedicated IAM user (`create_publisher_user = true`) over
root credentials for day-to-day `hostdoc` use.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README domain-mode section + external-DNS fallback"
```

---

### Task 7: 로컬 라이브 apply 검증 (사용자 게이트)

> **자동 테스트 아님.** 실 과금 리소스를 생성한다. **apply 직전 사용자에게 재확인**받는다. 실패/막힘 3회 시 멈추고 보고.

**Files:** 없음(운영 검증)

- [ ] **Step 1: tfvars 작성 (yeonigi.com)**

`infra/terraform.tfvars`:
```hcl
hosted_zone_name = "yeonigi.com"
subdomain        = "shared"
aws_region       = "us-east-1"
price_class      = "PriceClass_100"
```

- [ ] **Step 2: plan 확인**

Run: `cd infra && terraform init && terraform plan; cd ..`
Expected: 생성 리소스(S3·OAC·CF function·CF distribution·ACM·route53 records) plan 출력, 에러 없음.

- [ ] **Step 3: apply (⚠️ 사용자 재확인 후)**

Run: `cd infra && terraform apply; cd ..`
Expected: ~15-30분 후 완료. `terraform output`에 `site_domain=shared.yeonigi.com` 등.

- [ ] **Step 4: init + publish E2E**

Run:
```bash
node --import tsx src/index.ts init --from-terraform ./infra
node --import tsx src/index.ts publish ./<샘플폴더>
```
Expected: `https://shared.yeonigi.com/<code>/` 출력. 브라우저에서 해당 URL이 `index.html`을 HTTPS로 서빙.

- [ ] **Step 5: 무효화 + rm + 비공개 확인**

- 같은 slug에 `--force` 재배포 → CloudFront 무효화 후 갱신 반영 확인.
- `node --import tsx src/index.ts rm <code>` → 삭제 + 무효화 → URL 404 확인.
- S3 객체 URL 직접 접근(`https://<bucket>.s3.<region>.amazonaws.com/<code>/index.html`)이 **AccessDenied**(OAC 경유만) 확인.

- [ ] **Step 6: 정리 (사용자 선택)**

Run: `cd infra && terraform destroy; cd ..`  (검증용 리소스 제거. 유지 원하면 생략.)

---

## Self-Review (작성자 체크)

- **Spec 커버리지**:
  - §4.1 Terraform 모듈 → Task 5 (변수/리소스/outputs/tfvars 전부)
  - §4.2 index-rewrite.js → Task 4
  - §4.3 lib/cloudfront.ts → Task 1
  - §4.4 init --from-terraform → Task 3
  - §4.5 무효화 배선(publish/rm) → Task 2
  - §4.6 README → Task 6
  - §4.7 테스트 계획(URL 빌더/무효화/throttle/init/function) → Task 1·2·3·4 테스트. (cloudfront URL 빌더는 기존 `test/url.test.ts` 회귀로 커버 — 신규 분기 아님.)
  - §5 라이브 검증 → Task 7
- **Placeholder**: 없음(모든 코드/HCL/명령 실체 포함). Task 5의 validate-then-fix 게이트는 placeholder가 아니라 추측 금지 원칙의 검증 단계.
- **타입 일관성**: `makeCloudFront`/`invalidate` 시그니처가 Task 1 정의 ↔ Task 2 사용 일치. `runInit`/`readTerraformOutputs` Task 3 정의 ↔ test 일치. terraform output 키(`bucket_name`/`region`/`distribution_id`/`site_domain`)가 Task 5 outputs ↔ Task 3 `get(...)` ↔ init.test 픽스처 일치. 무효화 경로 `"/<code>/*"` 전 Task 일관.

## 실행 의존성

`Task 1 → 2`(무효화 소비), `Task 4 → 5`(function 파일 참조). `Task 3`은 독립. 권장 순서: 1 → 2 → 3 → 4 → 5 → 6 → 7.
