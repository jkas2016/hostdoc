# hostdoc — 버전관리/릴리스 자동화 설계 (semantic-release + npm OIDC)

- 날짜: 2026-06-19
- 선행 스펙: `docs/superpowers/specs/2026-06-18-hostdoc-cli-design.md` (§12 OSS 위생)
- 상태: 설계 확정 — 사용자 승인 완료, 플랜 작성 대기

## 1. 배경

`hostdoc`은 npm으로 배포하는 public CLI(`npm install -g hostdoc`, `bin.hostdoc → dist/index.js`)이지만 현재 버전관리 도구가 전혀 없다. `package.json`의 `version`은 수동값 `0.1.0`, git 태그·`CHANGELOG.md` 없음, 아직 npm 미배포. 이미 Conventional Commits(`feat:`/`fix:`/`refactor:`/`docs:`)를 수작업으로 지키고 있어 커밋 기반 자동 버전 산정과 잘 맞는다.

목표: 커밋에서 버전을 자동 산정해 npm publish + GitHub Release + CHANGELOG까지 **저장된 시크릿 없이** 처리한다.

## 2. 확정 결정 (브레인스토밍)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **semantic-release** 채택 (release-it·changesets 아님) | 커밋 기반 자동 산정의 목적특화 도구. release-it은 본질적으로 로컬 수동 bump, changesets는 모노레포·PR파일 지향이라 단일 패키지엔 과함 |
| D2 | **npm Trusted Publishing (OIDC)** 로 publish | 장기 NPM_TOKEN 0개. 실행당 단명 토큰 + provenance 자동. "자격증명 없는 CI" 원칙 유지 |
| D3 | 트리거 = **`workflow_dispatch`(수동)** | 여러 PR을 모아 릴리스 시점을 통제. 매 머지 패치 릴리스 노이즈 방지. commit-back이 릴리스 워크플로를 재트리거하지 않는 부수효과도 있음 |
| D4 | 첫 릴리스 = **1.0.0** | semantic-release 네이티브 동작(첫 릴리스 기본 1.0.0). Phase 1·2 완료 시점이라 명분도 충분. 0.x 유지는 도구와 안 싸우므로 비채택 |
| D5 | CHANGELOG = **파일 + GitHub Release 둘 다** | 레포에 `CHANGELOG.md` 커밋 + Releases 페이지 노트. commit-back 필요(아래 §3.1 무한루프 방지) |
| D6 | commitlint/husky = **미추가** | 이미 컨벤션 준수 중. YAGNI. 필요 시 후속 |
| D7 | 기존 `ci.yml`은 **변경 없음** | 자격증명 없는 build/typecheck/test 게이트는 그대로. 릴리스는 별도 워크플로로 분리 |

## 3. 아키텍처

### 3.1 `.releaserc.json`

브랜치 `main`. 플러그인 파이프라인(순서 중요):

| # | 플러그인 | 역할 |
|---|---|---|
| 1 | `@semantic-release/commit-analyzer` | Conventional Commits → bump 등급(patch/minor/major) 산정 |
| 2 | `@semantic-release/release-notes-generator` | 릴리스 노트 생성 |
| 3 | `@semantic-release/changelog` | `CHANGELOG.md` 갱신 |
| 4 | `@semantic-release/npm` | OIDC로 `npm publish` (provenance 자동 첨부) |
| 5 | `@semantic-release/github` | GitHub Release + git 태그 |
| 6 | `@semantic-release/git` | `CHANGELOG.md`+`package.json` commit-back |

**무한루프 방지**: `@semantic-release/git`의 기본 커밋 메시지는 `chore(release): ${nextRelease.version} [skip ci]` 형태로 `[skip ci]`를 포함한다. 릴리스 워크플로는 `workflow_dispatch`라 push로 재트리거되지 않고, 기존 `ci.yml`은 `[skip ci]` 덕분에 commit-back 커밋에서 실행되지 않는다.

### 3.2 `.github/workflows/release.yml`

```yaml
name: Release
on:
  workflow_dispatch:
permissions:
  contents: write        # GitHub Release + 태그 + commit-back
  issues: write          # 릴리스된 이슈 코멘트
  pull-requests: write   # 릴리스된 PR 코멘트
  id-token: write        # OIDC trusted publishing + provenance
jobs:
  release:
    runs-on: ubuntu-latest   # GitHub 호스티드 러너(OIDC 요건)
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # semantic-release는 전체 히스토리 필요
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install -g npm@latest   # ≥11.5.1 (Node 22는 npm 10 번들 → 업그레이드 필수)
      - run: npm ci
      - run: npm run build               # tsc → dist/
      - run: npx semantic-release
        # NPM_TOKEN 없음. GITHUB_TOKEN은 자동 주입.
```

- **시크릿 0개**: npm은 OIDC, GitHub Release는 내장 `GITHUB_TOKEN`.
- 정확한 액션 버전 핀·플러그인 버전 핀은 플랜에서 확정(`@semantic-release/npm`은 OIDC 지원이 들어간 ≥13.1.x).

### 3.3 `package.json` 변경

- `devDependencies`에 `semantic-release` + 플러그인 6종 추가.
- `dist/` 보장: `@semantic-release/npm`은 `npm publish`를 돌리므로 `prepack: "npm run build"`를 추가하면 publish 직전 항상 빌드된다(워크플로의 명시적 build 스텝과 이중 안전).
- `version` 필드는 이제 semantic-release가 관리(소스 수동값은 무의미해짐) — 단 npm 규칙상 필드 자체는 유지.

### 3.4 1회성 부트스트랩 (스펙 절차)

Trusted publishing은 패키지별 설정이고 `hostdoc`은 아직 npm에 없다. 따라서:
1. 로컬에서 최초 `npm publish` 1회(또는 일회성 토큰)로 `hostdoc` 패키지를 npm에 생성·확보.
2. npmjs.com → 패키지 Settings → **Trusted Publisher** 등록: org/user + repo + 워크플로 파일명(`release.yml`)(+선택 environment).
3. 이후 모든 릴리스는 `release.yml` 디스패치만으로 토큰 없이 자동.

> 부트스트랩의 정확한 순서(최초 publish를 trusted-publisher 등록 전/후 중 언제 하는지)는 플랜 단계에서 npm 공식 문서로 재확인한다.

## 4. 검증/테스트 계획 (구현 전 작성)

설정·CI 변경이라 "테스트"는 검증 절차 중심:

1. **로컬 dry-run**: `npx semantic-release --dry-run`(또는 `--no-ci`)으로 다음 버전·릴리스 노트가 의도대로 산정되는지 확인. 실제 publish/태그 없음.
2. **`.releaserc.json` 유효성**: semantic-release가 설정을 로드하고 6개 플러그인을 인식하는지(dry-run 로그).
3. **빌드 정합성**: `npm run build`로 `dist/` 생성 후 `npm pack`으로 tarball에 `dist/`만 포함되는지(`files: ["dist"]`) 확인.
4. **OIDC 경로**: 부트스트랩 후 첫 디스패치 실행이 NPM_TOKEN 없이 publish 성공 + provenance 첨부되는지.
5. **commit-back 루프 차단**: 릴리스 후 main에 들어온 `chore(release): … [skip ci]` 커밋에서 `ci.yml`이 실행되지 않는지.
6. **회귀**: 기존 `ci.yml`(build/typecheck/test)은 영향 없는지.

## 5. 비범위 (YAGNI)

- 매 머지 자동 릴리스(D3에서 수동 디스패치로 결정).
- commitlint/husky 커밋 강제(D6).
- 0.x 유지 워크플로(D4).
- 모노레포/멀티패키지 버저닝.
- prerelease/베타 채널, 백포트 브랜치.

## 6. 리스크

| 리스크 | 완화 |
|---|---|
| Node 22 러너가 npm 10 번들 → OIDC 실패 | `npm i -g npm@latest`로 ≥11.5.1 업그레이드 스텝 명시 |
| 셀프호스티드 러너 OIDC 미지원 | GitHub 호스티드(`ubuntu-latest`)만 사용 |
| `@semantic-release/npm` OIDC 초기 마찰(이슈 #1069 등) | ≥13.1.x로 핀, dry-run 선검증 |
| commit-back 무한루프 | `[skip ci]` + `workflow_dispatch` 트리거 |
| 부트스트랩 전 trusted-publisher 미동작 | 최초 1회 수동 publish 절차(§3.4) |

## 7. 참조 (검증한 공식 문서)

- npm trusted publishing GA(2025-07): https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/
- npm Trusted publishers(요건: npm ≥11.5.1, Node ≥22.14, GitHub 호스티드만): https://docs.npmjs.com/trusted-publishers/
- `@semantic-release/npm` OIDC 지원(권한 set, NPM_TOKEN 불필요): https://github.com/semantic-release/npm
- `@semantic-release/npm` 릴리스(OIDC = v13.1.0, 2025-10~): https://github.com/semantic-release/npm/releases
- Node 22가 npm 10 번들: https://nodejs.org/en/blog/release/v22.22.0
