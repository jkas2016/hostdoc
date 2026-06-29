# Terraform infra 하드닝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `infra/` Terraform의 6개 minor finding(Route53 영역 한정·`price_class` 검증·변수 description·IAM 키 평문 state 문서화·OAC `SourceAccount` 심층방어)을 닫는다.

**Architecture:** 전부 `infra/*.tf` + `README.md` 변경. `src/` 로직·CI 정책 불변. 검증은 로컬 Terraform CLI(`fmt`/`validate`/`plan`)로 한다 — CI는 Terraform을 실행하지 않으며 그 정책을 유지한다.

**Tech Stack:** Terraform (HCL), AWS provider `>= 5.0`, 로컬 CLI `terraform v1.15.6`.

## Global Constraints

- **`src/` 로직 변경 금지.** `src/lib/tfvars.ts`의 `price_class` 주입 경로 포함, 현행 유지.
- **CI에서 Terraform 실행 금지** — repo 정책. 검증은 구현자의 로컬 CLI에서만.
- **PGP/Secrets Manager 미구현** — IAM 키 finding은 **문서화만**.
- **HCL 스타일**: 2-space 들여쓰기, 블록 인자의 `=` 정렬(`terraform fmt`가 강제). 모든 변수에 `description`.
- **검증 사실(v1.15.6 실증)**: `terraform validate`는 `-var`를 무시하고 default로 평가하므로 `price_class` 거부는 `validate`로 확인 불가. 거부는 `terraform plan -var='price_class=bogus'`로 확인하며, 변수 validation은 **AWS 접속 전에** 평가되어 크리덴셜 없이 거부된다.
- 명령은 `terraform -chdir=infra ...` 형태로 repo 루트에서 실행한다(`infra/`는 이미 init됨 — `terraform.tfstate` 존재).

---

## File Structure

- Modify: `infra/variables.tf` — `price_class` validation+description, `create_publisher_user` description (Task 1)
- Modify: `infra/main.tf` — Route53 `private_zone=false`, `aws_caller_identity` data source + OAC `SourceAccount` (Task 2)
- Modify: `infra/outputs.tf` — IAM 키 회전/제거 주석 (Task 3)
- Modify: `README.md` — Security note에 평문 state 한 문장 (Task 3)
- Modify: `infra/terraform.tfvars.example` — `create_publisher_user` 발견성 주석 (Task 3)

새 파일 없음.

---

### Task 1: `variables.tf` 하드닝 (price_class 검증·description, create_publisher_user description)

**Files:**
- Modify: `infra/variables.tf:16-24`

**Interfaces:**
- Consumes: 없음(기존 변수 정의).
- Produces: `var.price_class`는 `PriceClass_100|200|All`만 허용(plan 시점 거부). 두 변수 모두 `description` 보유. Task 2/3는 이 변수들을 읽기만 한다.

- [ ] **Step 1: `price_class` 블록 교체 (validation + description 추가)**

`infra/variables.tf`의 다음 블록을

```hcl
variable "price_class" {
  type    = string
  default = "PriceClass_100"
}
```

다음으로 교체:

```hcl
variable "price_class" {
  type        = string
  default     = "PriceClass_100"
  description = "CloudFront price class: PriceClass_100 (cheapest; NA+EU), PriceClass_200, or PriceClass_All."
  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be one of: PriceClass_100, PriceClass_200, PriceClass_All."
  }
}
```

- [ ] **Step 2: `create_publisher_user` 블록 교체 (description 추가)**

`infra/variables.tf`의 다음 블록을

```hcl
variable "create_publisher_user" {
  type    = bool
  default = false
}
```

다음으로 교체:

```hcl
variable "create_publisher_user" {
  type        = bool
  default     = false
  description = "Create a dedicated least-privilege IAM publisher user + access key. The secret is stored in plaintext in terraform.tfstate — keep state private and rotate/destroy the key when done (see outputs.tf)."
}
```

- [ ] **Step 3: 포맷 확인**

Run: `terraform -chdir=infra fmt`
Expected: `variables.tf` (정렬 변경이 있었다면 파일명 출력, 없으면 무출력). 이후 `terraform -chdir=infra fmt -check`는 exit 0.

- [ ] **Step 4: config 유효성 (validate, default는 유효 → 통과)**

Run: `terraform -chdir=infra validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 5: 음성 테스트 — 잘못된 price_class가 plan에서 거부됨 (오프라인, 크리덴셜 불필요)**

Run:
```bash
terraform -chdir=infra plan -input=false -no-color \
  -var='hosted_zone_name=example.com' -var='subdomain=test' -var='aws_region=us-east-1' \
  -var='price_class=bogus'
```
Expected: 비-0 종료, 출력에 다음 포함(AWS 접속 전 변수 validation 단계에서 멈춤):
```
price_class must be one of: PriceClass_100, PriceClass_200, PriceClass_All.
```
(명시적 `-var`가 auto-load되는 `terraform.tfvars`보다 우선하므로 사용자의 실제 도메인은 사용되지 않는다.)

- [ ] **Step 6: 양성 sanity — 유효한 price_class는 validation 통과 (AWS 접속 전까지)**

Run:
```bash
terraform -chdir=infra plan -input=false -no-color \
  -var='hosted_zone_name=example.com' -var='subdomain=test' -var='aws_region=us-east-1' \
  -var='price_class=PriceClass_All' 2>&1 | grep -i "price_class must be" || echo "OK: price_class validation passed"
```
Expected: `OK: price_class validation passed` (validation 에러 없음. 이후 AWS 크리덴셜/네트워크 에러는 무관 — validation 통과가 확인 대상).

- [ ] **Step 7: Commit**

```bash
git add infra/variables.tf
git commit -m "$(cat <<'EOF'
infra: validate price_class + add var descriptions (#20)

price_class: restrict to PriceClass_100/200/All (plan-time rejection)
and add description. create_publisher_user: document the plaintext-state
IAM-key security implication.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `main.tf` 심층방어 (Route53 public 한정 + OAC SourceAccount)

**Files:**
- Modify: `infra/main.tf:26-28` (Route53 data source)
- Modify: `infra/main.tf:30-32` 부근 (새 `aws_caller_identity` data source 추가)
- Modify: `infra/main.tf:148-150` (OAC 버킷 정책 Condition)

**Interfaces:**
- Consumes: `data.aws_caller_identity.current.account_id` (이 태스크가 새로 정의).
- Produces: OAC 버킷 정책이 `SourceArn` + `SourceAccount` 병용. Route53 조회가 public 영역으로 한정.

- [ ] **Step 1: Route53 data source를 public 영역으로 한정**

`infra/main.tf`의

```hcl
data "aws_route53_zone" "this" {
  name = var.hosted_zone_name
}
```

를 다음으로 교체:

```hcl
data "aws_route53_zone" "this" {
  name         = var.hosted_zone_name
  private_zone = false
}
```

- [ ] **Step 2: `aws_caller_identity` data source 추가**

`infra/main.tf`의 `data "aws_cloudfront_cache_policy" "optimized"` 블록 바로 아래(현 32행 이후)에 추가:

```hcl
data "aws_caller_identity" "current" {}
```

- [ ] **Step 3: OAC 버킷 정책 Condition에 SourceAccount 추가**

`infra/main.tf`의 `aws_s3_bucket_policy.site` 안

```hcl
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn }
      }
```

를 다음으로 교체:

```hcl
      Condition = {
        StringEquals = {
          "AWS:SourceArn"     = aws_cloudfront_distribution.site.arn
          "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
        }
      }
```

- [ ] **Step 4: 포맷**

Run: `terraform -chdir=infra fmt`
Expected: `main.tf` 출력(정렬 변경). 이후 `terraform -chdir=infra fmt -check`는 exit 0.

- [ ] **Step 5: config 유효성 (새 data source·속성 참조 검증)**

Run: `terraform -chdir=infra validate`
Expected: `Success! The configuration is valid.`
(`data.aws_caller_identity.current.account_id`가 provider 스키마상 유효 속성임을, `private_zone` 인자가 유효함을 validate가 확인. data source 실제 read는 apply-time이라 AWS 접속 없음.)

- [ ] **Step 6: Commit**

```bash
git add infra/main.tf
git commit -m "$(cat <<'EOF'
infra: scope Route53 to public zone + OAC SourceAccount (#20)

data.aws_route53_zone: private_zone = false to avoid same-name
public/private ambiguity. OAC bucket policy: add AWS:SourceAccount
alongside SourceArn (AWS-recommended defense-in-depth).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: IAM 키·publisher 문서화 (outputs.tf 주석 + README + tfvars.example)

**Files:**
- Modify: `infra/outputs.tf` (sensitive publisher 출력 위 주석)
- Modify: `README.md` (Security note 문단, 현 85-89행)
- Modify: `infra/terraform.tfvars.example` (마지막 줄 뒤 주석)

**Interfaces:**
- Consumes: 없음(문서만).
- Produces: IAM 키 평문 state·회전·제거 방식이 세 곳(코드 근처·README·example)에 문서화.

- [ ] **Step 1: outputs.tf — 회전/제거 주석 추가**

`infra/outputs.tf`의 `output "publisher_access_key_id"` 블록 바로 위에 다음 주석을 추가:

```hcl
# create_publisher_user = true stores this secret in PLAINTEXT in terraform.tfstate.
# Keep state private. Rotate: terraform apply -replace='aws_iam_access_key.publisher[0]'.
# Remove: set create_publisher_user = false and re-apply (or destroy).
```

(즉, `output "publisher_access_key_id" {` 직전 줄들.)

- [ ] **Step 2: README.md — Security note에 평문 state 문장 추가**

`README.md`의 다음 문단

```markdown
The Terraform `publisher_policy_json` output is a minimal IAM policy for
publishing. Prefer a dedicated IAM user (`create_publisher_user = true`) over
root credentials for day-to-day `hostdoc` use.
```

를 다음으로 교체(끝에 한 문장 추가):

```markdown
The Terraform `publisher_policy_json` output is a minimal IAM policy for
publishing. Prefer a dedicated IAM user (`create_publisher_user = true`) over
root credentials for day-to-day `hostdoc` use. Enabling it stores the
access-key secret in plaintext in `terraform.tfstate`; keep state private and
rotate/destroy the key when done.
```

- [ ] **Step 3: tfvars.example — create_publisher_user 발견성 주석**

`infra/terraform.tfvars.example`의 마지막 줄(`price_class = ...`) 뒤에 한 줄 추가:

```hcl
# create_publisher_user = false  # optional dedicated IAM user (see README security note)
```

- [ ] **Step 4: 포맷 + 유효성 (outputs.tf 주석은 HCL이므로 fmt/validate 영향)**

Run: `terraform -chdir=infra fmt -check -recursive && terraform -chdir=infra validate`
Expected: fmt 무출력(exit 0) + `Success! The configuration is valid.`

- [ ] **Step 5: 문서 내용 육안 확인**

Run: `git diff --stat && grep -n "plaintext" README.md infra/outputs.tf && grep -n "create_publisher_user" infra/terraform.tfvars.example`
Expected: README.md·outputs.tf에 `plaintext` 라인, tfvars.example에 `create_publisher_user` 주석 라인 출력.

- [ ] **Step 6: Commit**

```bash
git add infra/outputs.tf README.md infra/terraform.tfvars.example
git commit -m "$(cat <<'EOF'
docs: document IAM publisher key plaintext-state handling (#20)

outputs.tf: rotation/removal guidance above the sensitive key outputs.
README security note + tfvars.example: surface the plaintext-state caveat
and the opt-in flag.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 최종 검증 (전체 fmt/validate + TS 회귀 sanity)

**Files:** 없음(검증만).

**Interfaces:** 없음.

- [ ] **Step 1: Terraform 전체 포맷·유효성**

Run: `terraform -chdir=infra fmt -check -recursive && terraform -chdir=infra validate`
Expected: fmt exit 0(무출력) + `Success! The configuration is valid.`

- [ ] **Step 2: price_class 거부 재확인 (회귀 가드)**

Run:
```bash
terraform -chdir=infra plan -input=false -no-color \
  -var='hosted_zone_name=example.com' -var='subdomain=test' -var='aws_region=us-east-1' \
  -var='price_class=bogus' 2>&1 | grep -c "price_class must be one of"
```
Expected: `1` (거부 메시지 1회 출력).

- [ ] **Step 3: TS 회귀 sanity (src 미변경 — 그린 유지 확인)**

Run: `npm run build && npm test`
Expected: build 성공, 전체 테스트 그린.

- [ ] **Step 4: 이슈 acceptance criteria 대조**

다음을 육안 확인(코드/문서 근거 명시):
- Route53 `private_zone = false` → `infra/main.tf` (Task 2).
- `price_class` plan-time 검증 → Step 2에서 `1` 확인.
- 모든 변수 description + IAM 키 처리 문서화 → `infra/variables.tf` (Task 1) + `infra/outputs.tf`·`README.md`·tfvars.example (Task 3).
- OAC `SourceArn` + `SourceAccount` → `infra/main.tf` (Task 2).

(별도 commit 없음 — 검증 전용 태스크.)

---

## Self-Review

**Spec coverage:**
- finding 1 (Route53 영역) → Task 2 Step 1. ✓
- finding 2 (IAM 키 평문 state, 문서화) → Task 1 Step 2(변수 description) + Task 3 Step 1·2·3(outputs/README/example). ✓
- finding 3 (OAC SourceAccount) → Task 2 Step 2·3. ✓
- finding 4 (price_class validation) → Task 1 Step 1, Task 1 Step 5 음성 테스트. ✓
- finding 5 (price_class description) → Task 1 Step 1. ✓
- finding 6 (create_publisher_user description) → Task 1 Step 2. ✓
- 인접(tfvars.example) → Task 3 Step 3. ✓
- spec test plan(fmt/validate/plan/npm) → Task 4. ✓

**Placeholder scan:** "TBD"/"적절히 처리"/빈 코드블록 없음. 모든 교체에 정확한 old→new HCL 명시. ✓

**Type/이름 일관성:** `data.aws_caller_identity.current`(Task 2 Step 2 정의 → Step 3 참조), `aws_iam_access_key.publisher[0]`(outputs.tf 주석, main.tf의 `count` 리소스와 일치), `price_class` 허용값 3종이 validation·description·error_message에서 동일. ✓
