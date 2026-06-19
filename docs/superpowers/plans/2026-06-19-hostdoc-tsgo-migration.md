# tsgo 마이그레이션 (타입체크 전용) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타입체크를 `tsc` → `tsgo`(`@typescript/native-preview`)로 전환하고, 자격증명 불필요한 JS 전용 GitHub Actions CI를 신설한다.

**Architecture:** tsgo는 **타입체크 전용**으로만 채택한다(`tsgo --noEmit`). `dist/` 게시 아티팩트의 emit은 stable `tsc`가 계속 담당한다(tsgo의 JS emit 파이프라인 미완). 전환 전 `tsgo --noEmit`와 `tsc --noEmit`의 진단 동등성(parity)을 확인한다.

**Tech Stack:** TypeScript 6.0.3(emit), `@typescript/native-preview`(tsgo, 타입체크), vitest, GitHub Actions.

## Global Constraints

- `typescript@^6.0.3`는 유지하고 `scripts.build`는 `"tsc"` 그대로 둔다(emit은 stable tsc).
- `@typescript/native-preview`는 dev 빌드 버전을 **정확히 핀**한다: `7.0.0-dev.20260618.1`.
- 새 타입체크 스크립트는 `"typecheck": "tsgo --noEmit"`.
- CI는 **JS 전용** — 자격증명·terraform 없음. Node 20.
- 기존 동작/테스트를 깨지 않는다(전체 vitest green 유지).

---

### Task 1: tsgo 타입체크 채택 (의존성 + 스크립트 + parity)

**Files:**
- Modify: `package.json` (devDependencies, scripts)

**Interfaces:**
- Consumes: 없음
- Produces: `npm run typecheck` 스크립트(이후 CI가 호출), `tsgo` 바이너리 사용 가능

- [ ] **Step 1: tsgo(native-preview) dev 빌드 핀 설치**

Run:
```bash
npm install -D @typescript/native-preview@7.0.0-dev.20260618.1
```
Expected: `package.json`의 `devDependencies`에 `"@typescript/native-preview": "7.0.0-dev.20260618.1"` 추가, `node_modules/.bin/tsgo` 생성.

- [ ] **Step 2: tsgo 바이너리 동작 확인**

Run:
```bash
npx tsgo --version
```
Expected: 버전 문자열 출력(에러 없이). 바이너리가 정상 설치되었는지 확인.

- [ ] **Step 3: `typecheck` 스크립트 추가**

`package.json`의 `scripts`를 다음과 같이 수정(기존 `build`/`test`/`dev`는 그대로):

```json
  "scripts": {
    "build": "tsc",
    "typecheck": "tsgo --noEmit",
    "test": "vitest run",
    "dev": "node --import tsx src/index.ts"
  },
```

- [ ] **Step 4: tsgo 타입체크 실행**

Run:
```bash
npm run typecheck
```
Expected: 진단 에러 없이 종료(exit 0). 현재 코드는 `tsc --noEmit`를 통과하므로 tsgo도 통과해야 한다.

- [ ] **Step 5: parity 확인 — tsc 타입체크와 동일 결과**

Run:
```bash
npx tsc --noEmit
```
Expected: 마찬가지로 에러 없이 exit 0. 두 도구의 진단이 동일(둘 다 clean)함을 확인. 만약 tsgo만 에러를 내면 tsconfig 옵션 호환성 문제이므로 멈추고 보고한다.

- [ ] **Step 6: emit(build) 무결성 확인**

Run:
```bash
npm run build && ls dist/index.js
```
Expected: `tsc`가 `dist/`로 emit, `dist/index.js` 존재. tsgo 도입이 emit 경로를 건드리지 않았음을 확인.

- [ ] **Step 7: 전체 테스트 green 확인**

Run:
```bash
npm test
```
Expected: 모든 vitest 스위트 PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: adopt tsgo for type-checking (tsc keeps emit)"
```

---

### Task 2: JS 전용 GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 1의 `npm run typecheck`
- Produces: PR/push 시 build + typecheck + test 게이트

- [ ] **Step 1: CI 워크플로 작성**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run typecheck
      - run: npm test
```

- [ ] **Step 2: 로컬에서 CI와 동일 명령 검증**

Run (CI가 실행할 것과 동일한 순서):
```bash
npm ci && npm run build && npm run typecheck && npm test
```
Expected: 4단계 모두 성공(exit 0). 로컬에서 green이면 CI에서도 동일하게 통과한다(자격증명 불필요).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add JS build/typecheck/test workflow (no AWS, no terraform)"
```

---

## Self-Review (작성자 체크)

- **Spec 커버리지**: 설계 §3.1(deps/scripts)→Task 1, §3.2(parity)→Task 1 Step 5, §3.3(JS CI)→Task 2, §3.4(게이트)→Task 1 Step 6-7 + Task 2 Step 2. 누락 없음.
- **Placeholder**: 없음.
- **타입 일관성**: 스크립트명 `typecheck` Task 1·2 일치. tsgo 버전 핀 `7.0.0-dev.20260618.1` Global Constraints·Task 1 일치.

## 검증 후 (PR 1 완료 기준)

`npm run build` + `npm run typecheck`(tsgo) + `npm test` 모두 green이면 PR 1 완료. main 머지 후 PR 2(Phase 2)는 갱신된 main에서 분기.
