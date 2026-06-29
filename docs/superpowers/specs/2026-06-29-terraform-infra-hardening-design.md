# Spec: Terraform infra 하드닝 (route53·IAM·validation·description)

- **Issue**: [#20](https://github.com/jkas2016/hostdoc/issues/20)
- **Date**: 2026-06-29
- **Source**: `deep-code-review` (2026-06-23) — Phase 2 domain/HTTPS mode(PR #3) 산출물 점검

## Problem

`infra/` Terraform은 동작은 정상이나, `deep-code-review`가 경계조건·심층방어·문서화
측면의 minor finding 6개를 보고했다. 데이터 손실/보안 결함은 아니며, 모두 cloudfront
모드(domain+distributionId)에서만 쓰이는 로컬 전용 Terraform에 한정된다(CI는 Terraform을
실행하지 않으며, 그 정책은 유지한다).

### Findings (출처: 이슈 #20)

1. **`main.tf:26` — Route53 영역 모호성.** `data.aws_route53_zone.this`가 이름만으로
   조회한다. 동명의 public/private 영역이 둘 다 있으면 에러 또는 private 해석으로 public
   DNS 레코드가 깨진다.
2. **`main.tf:186` (실제 `outputs.tf`) — IAM access key 비밀이 state 평문 저장.**
   `aws_iam_access_key.publisher`의 비밀키가 `terraform.tfstate`에 평문 저장된다(opt-in
   기본 false, sensitive 출력이라 영향 제한, 회전 메커니즘 없음).
3. **`main.tf:148` — OAC 버킷 정책에 `SourceAccount` 없음.** `AWS:SourceArn`만 사용한다.
   AWS 공식 OAC 템플릿은 `AWS:SourceAccount` 병용 심층방어를 권장한다(SourceArn에 계정
   ID가 이미 포함돼 갭은 작음).
4. **`variables.tf:16` — `price_class` validation 없음.** 자유 문자열이라 `--price-class`
   오타가 다른 리소스 생성 후 apply 시점에야 잡힌다. CloudFront는
   `PriceClass_100/200/All`만 허용.
5. **`variables.tf:16` — `price_class` description 누락.** 파일 내 다른 변수는 모두
   description이 있다(스타일 불일치).
6. **`variables.tf:21` — `create_publisher_user` description 누락.** IAM 사용자+키 생성을
   게이트하는 보안 함의가 정의부에 미문서화.

## Goal

Route53 조회를 public 영역으로 명확히 한정하고, `price_class`를 plan 시점에 검증하며,
모든 변수에 description을 부여하고, IAM 키 처리 방식(평문 state·회전·제거)을 문서화한다.
OAC 정책에 선택적 `SourceAccount` 심층방어를 추가한다. `src/` 로직과 CI 정책은 불변.

## Decisions

- **IAM 키(finding 2): 문서화만.** PGP(`pgp_key`)/Secrets Manager 구현은 채택하지 않는다 —
  `create_publisher_user`는 opt-in 기본 false에 secret은 이미 `sensitive` 출력이라, 추가
  의존성·스코프가 과하다. 대신 변수 description·outputs 주석·README에 회전/제거 가이드를
  남긴다.
- **OAC `SourceAccount`(finding 3): 추가.** data source 한 개 + Condition 한 줄로 AWS 공식
  권장 심층방어를 충족하고 이슈 체크박스를 닫는다. 저위험.
- 나머지 4개(finding 1·4·5·6)는 기계적 변경.

## Changes

### 1. `infra/variables.tf` — `price_class` validation + description (finding 4·5)

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

### 2. `infra/variables.tf` — `create_publisher_user` description (finding 6)

```hcl
variable "create_publisher_user" {
  type        = bool
  default     = false
  description = "Create a dedicated least-privilege IAM publisher user + access key. The secret is stored in plaintext in terraform.tfstate — keep state private and rotate/destroy the key when done (see outputs.tf)."
}
```

### 3. `infra/main.tf:26` — Route53 public 영역 한정 (finding 1)

```hcl
data "aws_route53_zone" "this" {
  name         = var.hosted_zone_name
  private_zone = false
}
```

### 4. `infra/main.tf` — OAC 버킷 정책에 `SourceAccount` 심층방어 (finding 3)

새 data source 한 개(파일 상단, 기존 data 블록 근처):

```hcl
data "aws_caller_identity" "current" {}
```

`aws_s3_bucket_policy.site`의 Condition을 다음으로 교체:

```hcl
Condition = {
  StringEquals = {
    "AWS:SourceArn"     = aws_cloudfront_distribution.site.arn
    "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
  }
}
```

### 5. `infra/outputs.tf` — IAM 키 회전/제거 주석 (finding 2)

`publisher_access_key_id`/`publisher_secret_access_key` sensitive 출력 위에 주석 추가:

```hcl
# create_publisher_user = true stores this secret in PLAINTEXT in terraform.tfstate.
# Keep state private. Rotate: terraform apply -replace='aws_iam_access_key.publisher[0]'.
# Remove: set create_publisher_user = false and re-apply (or destroy).
```

### 6. `README.md` — Security note 확장 (finding 2 문서화)

기존 "### Security note" 문단(현 88행, `create_publisher_user = true` 언급)에 한 문장 추가:

> Enabling it stores the access-key secret in plaintext in `terraform.tfstate`;
> keep state private and rotate/destroy the key when done.

### 7. (인접) `infra/terraform.tfvars.example` — `create_publisher_user` 발견성

example에 빠져 있어 주석 한 줄 추가(수동 셋업 사용자의 발견성):

```hcl
# create_publisher_user = false  # optional dedicated IAM user (see README security note)
```

## Test plan (검증 먼저)

`src/` 변경이 없고 CI는 Terraform을 실행하지 않으므로(repo 정책 유지), 검증은 로컬
Terraform CLI(v1.15.6 설치 확인됨) + TS 회귀 sanity로 한다.

- **포맷**: `terraform fmt -check -recursive infra/` — 그린.
- **config 유효성**: `terraform -chdir=infra validate` — config + validation 블록
  well-formedness. `infra/`는 이미 init됨(tfstate 존재).
- **`price_class` 거부 실증**: `terraform -chdir=infra validate -var='price_class=bogus'`로
  거부를 확인한다. validate가 변수 validation을 평가하지 않으면 plan-time 동작임을
  정직히 기록한다(거부 자체는 `validation` 블록 정의로 보장됨). Route53 `private_zone`·OAC
  `SourceAccount`의 런타임 효과는 live AWS apply-time이라 repo 정책상 CI/로컬 자동검증
  대상이 아니다 — config 정합성까지만 검증.
- **TS 회귀 sanity**: `npm run build && npm test` — src 미변경이라 그린 유지 확인용.

## Acceptance criteria (from issue)

- [ ] Route53 조회가 public 영역으로 명확히 한정된다(`private_zone = false`).
- [ ] `price_class`가 plan/validate 시점에 검증된다.
- [ ] 모든 변수에 description이 있고, IAM 키 처리 방식(평문 state·회전·제거)이 문서화된다.
- [ ] (추가) OAC 정책이 `SourceArn` + `SourceAccount` 심층방어를 사용한다.

## Non-goals

- PGP(`pgp_key`)/Secrets Manager 등 IAM secret 암호화·외부화 구현(doc-only로 결정).
- `#7` 중첩/다중 세그먼트 경로.
- `src/` 로직 변경(`tfvars.ts`의 `price_class` 주입 경로 포함 — 현행 유지).
- CI에서 Terraform 실행(repo 정책 유지).

## References

- `infra/main.tf` (`data.aws_route53_zone.this`, `aws_s3_bucket_policy.site`,
  `aws_iam_access_key.publisher`) · `infra/variables.tf` (`price_class`,
  `create_publisher_user`) · `infra/outputs.tf` (sensitive publisher 출력)
- `infra/terraform.tfvars.example` · `README.md` "Security note"
- AWS 공식 OAC 버킷 정책 템플릿(SourceArn + SourceAccount 심층방어) — finding 3 근거.
- 관련(완료): Phase 2 domain/HTTPS mode (PR #3), tfvars HCL 인젝션(#16, `src/lib/tfvars.ts`).
