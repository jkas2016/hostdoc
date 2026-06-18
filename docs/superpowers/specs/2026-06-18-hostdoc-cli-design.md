# hostdoc — 셀프호스팅 문서 퍼블리시 CLI (설계)

- 작성일: 2026-06-18
- 상태: 설계 확정 대기 (사용자 리뷰 전)
- 배포: 공개 GitHub + npm (`hostdoc`, MIT)

## 1. 개요

로컬 HTML 파일이나 폴더를 **사용자 본인의 AWS 인프라**에 올려 **공개 단축 링크**를 돌려주는 CLI.
htmlbook.io의 핵심("문서 → 퍼블리시 → 공유 링크")만 CLI로 가져오고, 웹 UI 계열 기능(테마·브라우저 편집·버전관리·인증 링크)은 전부 제외한다.

도구는 특정 도메인/계정에 묶이지 않는다. `example.com`은 작성자(사용자 1호)의 설정값일 뿐이며, 누구나 자기 도메인·버킷·배포를 지정하거나 도구가 직접 만들게 할 수 있다.

### 레퍼런스와의 차이
- htmlbook.io: 단축링크 `htmlbook.io/d/<code>`, HTML/MD 단일 문서, 웹 UI 중심, 호스팅 SaaS.
- hostdoc: 단축링크 `<host>/<code>/`, 파일 또는 폴더, CLI 전용, **사용자 셀프호스팅(AWS)**.

## 2. 핵심 흐름

```
$ hostdoc publish ./report.html
  → https://shared.example.com/x7Kq2a/

$ hostdoc publish ./site/ --slug aws-design
  → https://shared.example.com/aws-design/

$ hostdoc list           # 내가 올린 문서 목록
$ hostdoc rm x7Kq2a      # 삭제 (+ 도메인 모드면 무효화)
$ hostdoc open aws-design
```

## 3. 주요 결정 (확정)

| 항목 | 결정 | 근거 |
|---|---|---|
| 입력 형태 | 파일 또는 폴더 → `<code>/` prefix | 파일=`<code>/index.html`, 폴더=트리 전체. 에셋 참조 문서까지 커버, S3 prefix 모델과 일치 |
| 자격 증명 | AWS SDK 기본 자격증명 체인 + `--profile`/`--region` | env→SSO→공유 profile 자동 해석. root·IAM 사용자·SSO 모두 코드 변경 없이 지원 |
| 식별자 | 랜덤 base62 7자 기본 + 선택적 `--slug` | 비공개성(추측 불가) 기본 + 기억하기 쉬운 링크 옵션 |
| 런타임 | Node.js + TypeScript + AWS SDK v3, npm 배포 | JS 자격증명 체인 검증 완료, npm 배포 자연스러움 |
| 호스팅 | 2-모드: 도메인(CloudFront) / 무도메인(S3 website) | 도메인 있으면 HTTPS, 없으면 S3 기본 URL |
| 프로비저닝 | 무도메인=CLI `setup`, 도메인=Terraform | 쉬운 경우는 CLI가 즉석, 복잡한 경우는 IaC가 견고 |
| 이름 | `hostdoc` (npm 가용 확인) | — |

## 4. 아키텍처 — 호스팅 2-모드

### Mode A: 도메인 (CloudFront)
완전 비공개 S3 + OAC, CloudFront가 HTTPS로 서빙. **Terraform으로 프로비저닝.**

```
브라우저  https://shared.example.com/x7Kq2a/
   ▼  Route53  (shared.example.com  A/AAAA alias → CloudFront)
   ▼  CloudFront  (HTTPS, ACM 인증서 @us-east-1)
        └ Viewer-request Function: URI가 '/'로 끝나거나 확장자 없으면 '/index.html' 부착,
                                    '/_'로 시작하는 경로는 403 (메타데이터 보호)
   ▼  OAC (Origin Access Control) 서명
   ▼  S3 버킷 (완전 비공개)   키: x7Kq2a/index.html, x7Kq2a/assets/…
```
- URL: `https://<subdomain>.<domain>/<code>/`
- HTTPS ✅ / 하위경로 index = CloudFront Function / 덮어쓰기 시 `/<code>/*` 무효화 / 버킷 완전 비공개
- **CloudFront Function이 필요한 이유**: CloudFront의 Default Root Object는 루트(`/`)에만 적용되고 하위 디렉터리에는 적용되지 않음 (아래 References 참조).

### Mode B: 무도메인 (S3 정적 웹사이트 호스팅)
공개 버킷 + S3 website 엔드포인트. **CLI `setup`으로 프로비저닝.**

```
브라우저  http://<bucket>.s3-website-<region>.amazonaws.com/x7Kq2a/
   ▼  S3 정적 웹사이트 호스팅 (index document = index.html, 공개 read)
   ▼  /x7Kq2a/ → /x7Kq2a/index.html  (S3 index document 네이티브)
```
- URL: `http://<bucket>.s3-website-<region>.amazonaws.com/<code>/`
- HTTPS ❌ (S3 website는 SSL 미지원) / 하위경로 index = S3 네이티브 / 무효화 불필요(CDN 없음, 즉시 반영) / 버킷 공개 read
- 용도: 도메인 없을 때, 빠른/내부 공유. 공개 실사용은 도메인 모드 권장.

### 공통 / 분기
업로드 로직(파일·폴더 → `<code>/`, Content-Type 설정, 메타 기록)은 모드 공통.
모드별 차이는 **URL 빌더**와 **무효화 단계(Mode A만)**, **버킷 공개성(프로비저닝 단계)** 뿐.

## 5. CLI 설계

| 명령 | 동작 |
|---|---|
| `setup [--region]` | 무도메인 인프라 생성(S3 website) + config 기록 |
| `init --from-terraform <dir>` | 도메인 인프라(Terraform output) 가져와 config 기록 |
| `publish <path>` | 파일/폴더 업로드, URL 출력(+클립보드) |
| `list` | `_meta/*.json` 읽어 표: 코드·slug·제목·생성일·URL |
| `rm <code\|slug>` | prefix 전체 + 메타 삭제 (+ Mode A 무효화) |
| `open <code\|slug>` | URL 브라우저로 열기 |
| `config show` | 현재 활성 config 출력 |

**공통 플래그**: `--profile` · `--region` · `--bucket`/`--distribution`/`--domain`(override) · `--dry-run`
**publish 플래그**: `--slug <name>` · `--title <t>` · `--force`(덮어쓰기) · `--open`
**rm 플래그**: `--yes`

### 동작 디테일
- **코드 생성**: `crypto.randomBytes` → base62 7자(≈3.5조). 충돌 시 `ListObjectsV2`(prefix `<code>/`, MaxKeys 1) 확인 후 재생성, 최대 5회.
- **slug 검증**: `^[a-z0-9][a-z0-9-]{0,62}$`. `_` 시작 금지, 예약어(`index.html` 등) 금지. 충돌 시 `--force` 없으면 거부.
- **덮어쓰기**(같은 slug 재배포): 기존 prefix 키 목록과 diff → 삭제분 제거 + 신규 업로드 (+ Mode A 무효화).
- **Content-Type**: `mime-types` 패키지로 확장자→MIME, 미상은 `application/octet-stream`. 각 `PutObject`에 `ContentType` 설정. `Cache-Control` 기본 `public, max-age=300`(설정 가능).
- **빈 폴더 / index.html 없는 폴더**: 경고 후 진행(엔트리 추정), 단일 파일은 항상 `<code>/index.html`로 저장.

## 6. 식별자 & 메타데이터
- 메타 사이드카: `_meta/<code>.json` = `{ code, slug, title, createdAt, files, bytes, sourcePath }`.
- title: 엔트리 `index.html`의 `<title>` 파싱, 없으면 파일/폴더명.
- `_meta/` 보호:
  - Mode A: 버킷 완전 비공개 + CloudFront Function이 `/_` 경로 403 → CDN으로 노출 불가.
  - Mode B: 공개 버킷 정책을 `arn:…/*` 허용하되 `arn:…/_meta/*`는 `Principal:*`에 대해 명시적 Deny. 인증된 CLI만 메타 접근.

## 7. 구성 & 자격 증명

**자격 증명**: 코드에 키를 두지 않고 SDK 기본 체인에 위임. `--profile`/`AWS_PROFILE`, `--region`/`AWS_REGION`만 노출. → root·env 키 / 전용 IAM 사용자 profile / SSO 모두 동작. (aws CLI 로그인 상태면 동일 소스를 그대로 사용.)

**인프라 좌표 config** (`~/.config/hostdoc/config.json`):
```json
// Mode A
{ "mode": "cloudfront", "bucket": "...", "region": "...", "distributionId": "...", "domain": "shared.example.com" }
// Mode B
{ "mode": "s3-website", "bucket": "...", "region": "...", "websiteEndpoint": "http://...s3-website-..." }
```
**우선순위**: `--bucket/--distribution/--domain/--region` 플래그 > `HOSTDOC_*` 환경변수 > config 파일.
CLI는 이 4개 값만 알면 동작하므로, 이 도구의 Terraform이 아닌 **bring-your-own 인프라**도 지정 가능.

## 8. 프로비저닝

### 8.1 CLI `setup` (Mode B, SDK 직접)
로그인된 자격증명으로 즉석 생성 (수 초, Terraform 불필요):
1. `CreateBucket` (지정 리전; us-east-1 LocationConstraint 예외 처리)
2. `PutPublicAccessBlock` 해제 (공개 정책 허용)
3. `PutBucketWebsite` (index document = `index.html`)
4. `PutBucketPolicy` (공개 read `s3:GetObject` on `/*`, `_meta/*` Deny)
5. `~/.config/hostdoc/config.json` 기록 (mode=s3-website, websiteEndpoint)

### 8.2 Terraform (Mode A, `infra/`)
`terraform.tfvars`만 채우면 `terraform apply` 한 번:
```hcl
hosted_zone_name = "example.com"     # 이미 Route53에 있는 zone (data 조회)
subdomain        = "shared"          # → shared.example.com
aws_region       = "us-east-1"       # 버킷 리전 (인증서는 항상 us-east-1)
price_class      = "PriceClass_100"  # CloudFront 최저가
```
생성 리소스: 비공개 S3 버킷 · OAC · CloudFront Function(`index-rewrite.js`) · CloudFront 배포 · 버킷 정책(distribution ARN 한정) · ACM 인증서(us-east-1 provider alias, DNS 검증 자동) · Route53 A/AAAA alias.
**outputs**: `bucket_name`, `distribution_id`, `site_domain`, `region`, `publisher_policy_json`(붙이면 끝나는 최소권한 IAM 정책).
옵션 변수: `create_publisher_user`(기본 false; true면 전용 IAM 사용자+키 발급).

### 8.3 DNS 범위
- **지원(자동)**: 도메인 DNS가 Route53 hosted zone → ACM 검증 + alias 전부 자동.
- **수동 폴백(문서만)**: 외부 DNS(Cloudflare 등)는 ACM 검증 CNAME·별칭 수동 추가. 자동화 범위 밖, README 안내.

## 9. 저장소 구조
```
hostdoc/                     # public repo
  infra/    main.tf  variables.tf  outputs.tf  index-rewrite.js  terraform.tfvars.example
  src/      index.ts
            commands/{setup,init,publish,list,rm,open,config}.ts
            lib/{aws,code,mime,config,meta,url}.ts
  test/
  README.md  LICENSE  .gitignore  package.json  tsconfig.json
  docs/superpowers/specs/2026-06-18-hostdoc-cli-design.md
```

## 10. 에러 처리
명확한 메시지 + 0 아닌 종료코드:
- 자격증명 없음 / config 누락(어떤 명령으로 만들지 안내)
- (도메인) Route53 hosted zone 없음
- slug 충돌(`--force` 안내) / 경로 없음 / 빈 폴더 / index.html 없는 폴더(경고)
- (Mode A) CloudFront 무효화 throttle → 지수백오프 재시도
- (setup) Public Access Block / 기존 버킷 충돌 → 안내

## 11. 테스트 계획 (구현 전 작성)
- **단위**: 코드 생성(길이·charset·충돌 재시도) · slug 검증 · Content-Type 매핑 · 키/prefix 빌더 · 메타 직렬화 · URL 빌더(모드별) · 무효화 경로.
- **통합**: `aws-sdk-client-mock`으로 S3/CloudFront 목 —
  - `setup`: CreateBucket·website·policy 호출 검증
  - `publish`: 기대 키·Content-Type로 PutObject, 충돌 재시도, 모드별 URL
  - `rm`: prefix 전부 삭제 + (Mode A) 무효화
  - `list`: `_meta` 파싱
- **인프라**: CI에서 `terraform fmt -check` + `validate` + `plan` (apply 안 함).
- `--dry-run`: 실호출 없이 계획 출력 (테스트 보조 겸용).

## 12. OSS 위생
MIT 라이선스 · `terraform.tfvars.example` · `.gitignore`(`node_modules`, `.terraform/`, `*.tfstate*`, 로컬 config) · 비밀 미커밋 · CI(lint + test + terraform validate/plan) · README 온보딩(준비물·Quick Start·두 모드 안내·외부 DNS 폴백).

## 13. 범위 밖 (YAGNI)
웹 UI · 테마 · 브라우저 편집 · 버전 관리 · 인증/비공개 링크 · Markdown→테마 변환 · 만료/비밀번호 · 다중 사이트 명명 프로필(하나의 활성 config만; 임시 전환은 flag/env) · 외부 DNS 자동화 · CLI를 통한 도메인 모드 프로비저닝.

## 14. 구현 단계 (플랜용 제안)
- **Phase 1 — Mode B 엔드투엔드**: config·자격증명, `setup`, `publish`/`list`/`rm`/`open`, 메타, 테스트. 도메인 없이 바로 사용 가능.
- **Phase 2 — Mode A**: Terraform(`infra/`) + CloudFront Function + `init --from-terraform` + 무효화 + 모드 분기. README/CI/라이선스 마감.

## 15. References (검증한 공식 문서)
- AWS account root user (root 키 비권장): https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html
- AWS SDK for JavaScript v3 — 자격증명 체인(env→SSO→profile): https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html
- CloudFront Default Root Object(하위경로 미적용): https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DefaultRootObject.html
- S3 Website Endpoints(HTTP 전용·공개 필요·하위 index): https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteEndpoints.html
