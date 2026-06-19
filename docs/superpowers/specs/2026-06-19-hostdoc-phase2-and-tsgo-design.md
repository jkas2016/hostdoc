# hostdoc — Phase 2(도메인/HTTPS 모드) + tsgo 마이그레이션 설계

- 날짜: 2026-06-19
- 관련 이슈: [#1 — Phase 2 custom-domain HTTPS mode](https://github.com/jkas2016/hostdoc/issues/1)
- 선행 스펙: `docs/superpowers/specs/2026-06-18-hostdoc-cli-design.md` (Mode A)
- 선행 플랜: `docs/superpowers/plans/2026-06-18-hostdoc-phase1-s3-website.md`

## 1. 배경

`hostdoc`는 **사용자가 다운로드해 자기 로컬 PC에서 실행하는 public CLI 도구**다. Phase 1은 무도메인(S3 website) 모드를 출시했다. 이 설계는 두 가지 독립 작업을 다룬다.

1. **PR 1 — tsgo 마이그레이션**: 타입체크를 `tsc` → `tsgo`(TypeScript native preview)로 전환. 작은 툴체인 작업, 먼저 실행해 빌드/CI 베이스라인을 세운다.
2. **PR 2 — Phase 2 도메인/HTTPS 모드**: CloudFront + ACM + Route53 + 비공개 S3(OAC)를 Terraform으로 프로비저닝하고, CLI의 `cloudfront` 런타임 경로(무효화, `init --from-terraform`)를 완성한다. (이슈 #1)

단일 브레인스토밍 → 단일 설계 문서 → 실행은 **2개 PR 순차**(`PR 1 → PR 2`).

## 2. 확정 결정 (브레인스토밍)

| # | 결정 | 근거 |
|---|---|---|
| D1 | tsgo와 Phase 2는 **별도 PR**, tsgo 먼저 | 두 작업은 독립적. 리뷰·롤백이 깔끔. (`한 작업은 한 PR`) |
| D2 | tsgo는 **타입체크 전용** — `tsc`는 emit 유지 | tsgo의 JS emit 파이프라인은 미완(2025-12 기준). 게시 아티팩트(`dist/`)는 stable `tsc`가 계속 emit |
| D3 | `init --from-terraform`은 **`terraform output -json` 쉬아웃** | 항상 최신 state 반영. 사용자는 이미 terraform을 가진 사람 |
| D4 | **terraform은 CI에서 일절 실행 안 함** | hostdoc은 각 사용자 로컬에서 도는 public CLI. 레포 CI가 AWS를 만지면 안 됨. (이슈 #1의 "CI: terraform plan" 항목은 **철회**) |
| D5 | GitHub Actions는 **JS 전용 CI만** | 자격증명 불필요한 build + typecheck + 목 테스트만. public 레포 품질 게이트 표준 |
| D6 | Phase 2 검증은 **로컬 라이브 apply**까지 | Route53에 실도메인 `yeonigi.com` 보유 → `shared.yeonigi.com`에 실제 apply로 end-to-end 검증. apply 직전 재확인, 종료 후 destroy 여부 선택 |

---

## 3. PR 1 — tsgo 마이그레이션 (타입체크 전용)

### 3.1 패키지/스크립트 변경

| 항목 | 변경 |
|---|---|
| `devDependencies` | `@typescript/native-preview` 추가, dev 빌드 핀 `7.0.0-dev.20260618.1` (재현성) |
| `typescript` | `^6.0.3` **유지** (emit 담당) |
| `scripts.build` | `"tsc"` **그대로** (stable tsc로 `dist/` emit) |
| `scripts.typecheck` | **신설** `"tsgo --noEmit"` |

`tsgo`는 tsc 호환 CLI(`--noEmit`, `-p` 등)를 제공한다. tsx(개발 실행)·vitest(테스트)는 각자 esbuild로 트랜스파일하므로 영향 없음.

### 3.2 parity 검증

1. `tsgo --noEmit`와 `tsc --noEmit`를 둘 다 실행해 진단 결과가 동일한지 확인.
2. `npm run build`(tsc emit) 성공 확인.
3. 전체 vitest 스위트 green 확인.
4. parity 확인 후 tsgo를 정식 타입체크로 채택(CI는 tsgo만 실행).

### 3.3 JS CI (`.github/workflows/ci.yml`)

- 트리거: `push` / `pull_request`.
- Node 20 (engines `>=18`).
- 단계: `npm ci` → `npm run build` → `npm run typecheck`(tsgo) → `npm test`(vitest, AWS는 `aws-sdk-client-mock`으로 목).
- **자격증명·terraform 없음.**

### 3.4 게이트
`build` green + `tsgo --noEmit` green + 전체 테스트 green.

---

## 4. PR 2 — Phase 2 도메인/HTTPS 모드 (이슈 #1)

스펙 §4(Mode A)·§8.2를 구현한다. 업로드 로직은 모드 공통이고, Mode A가 추가하는 것은 **(a) Terraform 프로비저닝, (b) CloudFront 무효화 단계, (c) `init --from-terraform`** 뿐이다.

### 4.1 Terraform 모듈 `infra/`

파일: `main.tf` · `variables.tf` · `outputs.tf` · `index-rewrite.js` · `terraform.tfvars.example`

**변수** (`variables.tf`):

| 변수 | 의미 | 기본 |
|---|---|---|
| `hosted_zone_name` | 이미 Route53에 있는 zone (data 조회) | — |
| `subdomain` | → `<subdomain>.<hosted_zone_name>` | — |
| `aws_region` | 버킷 리전 (인증서는 항상 us-east-1) | — |
| `price_class` | CloudFront 가격 등급 | `PriceClass_100` |
| `create_publisher_user` | true면 전용 IAM 사용자+키 발급 | `false` |

**Provider**: 기본 provider(`aws_region`) + **`us-east-1` alias**(ACM은 CloudFront 요건상 us-east-1 필수).

**State**: 로컬 state. `.gitignore`에 `.terraform/`·`*.tfstate*` 이미 제외됨.

**생성 리소스** (스펙 §8.2):
- 비공개 S3 버킷 — Block Public Access 전체 ON.
- CloudFront **Origin Access Control(OAC)**.
- 버킷 정책 — **distribution ARN으로 한정**(`AWS:SourceArn` 조건)된 `s3:GetObject` 허용.
- CloudFront **Function**(`index-rewrite.js`, viewer-request) — 아래 4.2.
- CloudFront 배포 — OAC origin, 기본 루트 객체, `price_class`, viewer-request에 Function 연결.
- **ACM 인증서**(us-east-1 alias) + Route53 **DNS 검증**(자동) — `aws_acm_certificate` + `aws_route53_record`(검증) + `aws_acm_certificate_validation`.
- Route53 **A/AAAA alias** → 배포.

**outputs** (`outputs.tf`): `bucket_name` · `distribution_id` · `site_domain` · `region` · `publisher_policy_json`(붙이면 끝나는 최소권한 IAM 정책 JSON). `create_publisher_user=true`일 때 사용자/키 출력.

### 4.2 `index-rewrite.js` (CloudFront Function)

viewer-request 함수:
- URI가 `/`로 끝나거나 마지막 세그먼트에 확장자(`.`)가 없으면 `index.html` 부착 → 하위 디렉터리 인덱스 처리. (CloudFront Default Root Object는 루트에만 적용되므로 필요.)
- URI가 `/_`로 시작하면 **403** 반환 → `_meta/` 보호.

### 4.3 `lib/cloudfront.ts` (신규)

- 신규 의존성: `@aws-sdk/client-cloudfront`.
- `invalidate(distributionId, paths)` — `CreateInvalidationCommand`로 `/<code>/*` 무효화.
- throttle(`TooManyInvalidationsInProgress` 등) 시 **지수백오프 재시도**.
- `CallerReference`는 코드+타임스탬프 등으로 고유화.

### 4.4 `init --from-terraform <dir>` 명령 (신규 `commands/init.ts`)

- `terraform -chdir=<dir> output -json`을 `child_process`로 실행 → JSON 파싱.
- `bucket_name`·`region`·`distribution_id`·`site_domain`을 읽어 `{ mode: "cloudfront", bucket, region, distributionId, domain }` config 저장(`saveConfig`).
- terraform 미설치/output 누락/`apply` 안 된 디렉터리에 대해 명확한 에러.
- `src/index.ts`에 서브커맨드 배선.

### 4.5 무효화 배선

- **`publish`**: 덮어쓰기(`--force`로 기존 prefix 삭제)가 일어난 cloudfront 모드에서 업로드 후 `/<code>/*` 무효화. 신규 발행(빈 prefix)은 무효화 불필요.
- **`rm`**: cloudfront 모드에서 삭제 후 `/<id>/*` 무효화. (`rm.ts`의 `// Phase 2 ... invalidate` 자리 완성.)
- s3-website 모드는 무효화 없음(즉시 반영).

### 4.6 README

- 도메인 모드 섹션: 준비물(Route53 hosted zone)·`terraform.tfvars` 작성·`apply`·`hostdoc init --from-terraform ./infra`·`publish` 흐름.
- 외부(비-Route53) DNS **수동 폴백**: ACM 검증 CNAME·alias 수동 추가 안내(자동화 범위 밖).
- root 자격증명 대신 `publisher_policy_json` 기반 전용 IAM 사용자 권장 노트.

### 4.7 테스트 계획 (구현 전 작성 — production 코드보다 먼저)

`aws-sdk-client-mock` 기반 단위/통합:
- **cloudfront URL 빌더**: `buildPublicUrl(cfg, code)`가 cloudfront 모드에서 `https://<domain>/<code>/` 반환 (기존, 회귀 확인).
- **무효화 경로**: `publish` 덮어쓰기 시 `CreateInvalidation`이 `/<code>/*`로 1회 호출. 신규 발행 시 미호출.
- **`rm` 무효화**: 삭제 후 `/<id>/*` 무효화 호출.
- **throttle 재시도**: throttle 에러 1~2회 후 성공하는 목 → 재시도 동작 확인.
- **`init --from-terraform` 파싱**: `terraform output -json` 출력(목/픽스처)에서 cloudfront config 생성. terraform 미설치 시 명확한 에러.
- **CloudFront Function 로직**: `index-rewrite.js`의 순수 함수 부분(있다면)에 대한 URI 변환/403 테스트(가능 범위).

---

## 5. 검증 계획 (PR 2, 로컬)

1. `brew install terraform` (현재 미설치).
2. `cd infra && terraform init && terraform fmt -check && terraform validate`.
3. `terraform.tfvars`: `hosted_zone_name="yeonigi.com"`, `subdomain="shared"`, `aws_region=<선택>`, `price_class="PriceClass_100"`.
4. **`terraform apply`** — ⚠️ 실 과금 리소스(CloudFront·ACM·Route53) 생성, CloudFront+ACM 검증 ~15–30분. **apply 직전 사용자 재확인.**
5. `hostdoc init --from-terraform ./infra` → cloudfront config 생성 확인.
6. `hostdoc publish <샘플>` → `https://shared.yeonigi.com/<code>/`가 콘텐츠 서빙 확인.
7. 덮어쓰기(`--force`) 후 무효화 동작, `hostdoc rm`으로 삭제+무효화 확인.
8. S3 버킷이 공개로 직접 읽히지 않음(OAC 경유만) 확인.
9. 종료 후 `terraform destroy` 여부는 사용자 선택.

**보안 메모**: 현재 root 자격증명 사용 중. 장기적으로 `publisher_policy_json` 기반 전용 IAM 사용자 권장.

## 6. 비범위 (이슈 #1 Non-goals)

- 외부 DNS 자동화(Route53 외 zone은 문서 폴백만).
- Web UI·테마·인-브라우저 편집·버전 히스토리·인증/비공개 링크·Markdown→테마 변환.
- 다중 사이트 named profile(단일 활성 config 유지).
- **terraform을 CI/원격에서 실행**(로컬 전용).

## 7. 리스크

| 리스크 | 완화 |
|---|---|
| ACM은 us-east-1 필수(버킷과 cross-region) | 전용 `us-east-1` provider alias |
| CloudFront 배포 + ACM 검증 수 분 소요 | 예상 대기 문서화, TF 검증 waiter 사용 |
| Default Root Object가 하위 경로 미적용 | CloudFront Function이 `index.html` 부착 |
| 외부 DNS는 완전 자동화 불가 | 수동 검증/alias 폴백 문서화 |
| tsgo JS emit 미완 | emit은 stable tsc 유지(타입체크만 tsgo) |
| CloudFront 무효화 throttle | 지수백오프 재시도 |

## 8. 참조

- 이슈 #1: https://github.com/jkas2016/hostdoc/issues/1
- 디자인 스펙(Mode A): `docs/superpowers/specs/2026-06-18-hostdoc-cli-design.md`
- Phase 1 플랜: `docs/superpowers/plans/2026-06-18-hostdoc-phase1-s3-website.md`
- CloudFront Default Root Object(하위경로 미적용): https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DefaultRootObject.html
- TypeScript native port(tsgo) 패키지: `@typescript/native-preview` (npm)
