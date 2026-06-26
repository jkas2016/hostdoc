# 독립 I/O 병렬화 (publish 업로드·walk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** publish의 파일별 업로드를 bounded concurrency(8)로 병렬화하고, 디렉터리 walk를 레벨별 `Promise.all`로 병렬화한다 — 동작·비용 불변, 다수 파일 폴더 publish의 벽시계 시간만 단축.

**Architecture:** 새 유틸 `mapLimit`(커서 기반 워커 풀, 결과 순서 보존, fail-fast)을 도입한다. 업로드는 `mapLimit(8)`로 한도를 걸고(`readFile`를 태스크 내부에 유지해 피크 메모리를 동시 8개로 한정), walk는 디렉터리 레벨 `Promise.all`로 병렬화한다. meta 기록·CloudFront 무효화는 모든 업로드 완료 후로 유지.

**Tech Stack:** TypeScript(ESM) · Node ≥22.12 · vitest · aws-sdk-client-mock · `@aws-sdk/client-s3`.

**Spec:** `docs/superpowers/specs/2026-06-26-publish-io-parallelization-design.md`

## Global Constraints

- ESM: `.ts` 소스의 상대 import는 `.js` 확장자 필수 (예: `../lib/concurrency.js`).
- Node `>=22.12`.
- 테스트는 vitest + aws-sdk-client-mock. AWS는 mock — CI는 AWS creds·Terraform 없음. 상태는 `HOSTDOC_*` env로 주입.
- `src/lib/aws.ts`(`putObject` 등)는 **무변경**. meta 기록·무효화 블록 위치 **유지**.
- 동시성 한도 = 고정 상수 `8` (설정 노출 없음, YAGNI).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 추가.

---

### Task 1: `mapLimit` bounded-concurrency 유틸

**Files:**
- Create: `src/lib/concurrency.ts`
- Test: `test/concurrency.test.ts`

**Interfaces:**
- Consumes: (없음)
- Produces: `mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`
  — 동시 실행 ≤ `limit`; 결과 순서 보존(`results[i] ↔ items[i]`); 첫 reject 시 새 작업 스케줄 중단 + 그 에러로 reject; 빈 배열 → `[]`; `limit<=0`/`limit>=n` 안전 클램프.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/concurrency.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapLimit } from "../src/lib/concurrency.js";

describe("mapLimit", () => {
  it("returns [] for empty input", async () => {
    const out = await mapLimit([], 4, async () => 1);
    expect(out).toEqual([]);
  });

  it("preserves result order regardless of completion order", async () => {
    const items = [30, 10, 20];
    const out = await mapLimit(items, 3, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(out).toEqual([60, 20, 40]);
  });

  it("passes the index to fn", async () => {
    const out = await mapLimit(["a", "b", "c"], 2, async (item, i) => `${i}:${item}`);
    expect(out).toEqual(["0:a", "1:b", "2:c"]);
  });

  it("never exceeds the concurrency limit but does run in parallel", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapLimit(items, 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("propagates the first rejection", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("stops scheduling after a rejection (serial limit)", async () => {
    const seen: number[] = [];
    await expect(
      mapLimit([0, 1, 2], 1, async (n) => {
        seen.push(n);
        if (n === 0) throw new Error("stop");
        return n;
      }),
    ).rejects.toThrow("stop");
    expect(seen).toEqual([0]);
  });

  it("handles limit >= length", async () => {
    const out = await mapLimit([1, 2, 3], 100, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30]);
  });

  it("treats limit <= 0 as serial (no hang)", async () => {
    const out = await mapLimit([1, 2], 0, async (n) => n);
    expect(out).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/concurrency.test.ts`
Expected: FAIL — `mapLimit` not found (모듈 미존재).

- [ ] **Step 3: 최소 구현 작성**

`src/lib/concurrency.ts`:

```ts
/**
 * Run `fn` over `items` with at most `limit` concurrent invocations.
 * Results keep input order. On the first rejection, no new tasks are
 * scheduled and the returned promise rejects with that error (in-flight
 * tasks settle but their results are ignored).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  let failed = false;

  async function worker(): Promise<void> {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run test/concurrency.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/concurrency.ts test/concurrency.test.ts
git commit -m "feat: add mapLimit bounded-concurrency helper (#19)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: walk 병렬화 (디렉터리 레벨 `Promise.all`)

**Files:**
- Modify: `src/lib/walk.ts:12-29` (`walkDir`), `src/lib/walk.ts:51-54` (`collectUploads` 호출부)
- Test: `test/walk.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: (없음 — fs/path/mime 기존)
- Produces: `collectUploads(inputPath: string): Promise<Upload[]>` (시그니처·동작 불변). 내부 `walkDir(root, current): Promise<Upload[]>`로 변경(누적자 파라미터 제거).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/walk.test.ts`의 `describe("collectUploads", ...)` 안에 추가:

```ts
  it("walks a deeply nested tree, preserving all keys", async () => {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "a", "b"));
    writeFileSync(join(dir, "a", "top.css"), "body{}");
    writeFileSync(join(dir, "a", "b", "deep.js"), "//x");
    const ups = await collectUploads(dir);
    const keys = ups.map((u) => u.key).sort();
    expect(keys).toEqual(["a/b/deep.js", "a/top.css", "index.html"]);
  });
```

- [ ] **Step 2: 테스트 실패/통과 상태 확인 (기존 구현 기준)**

Run: `npx vitest run test/walk.test.ts`
Expected: 새 케이스 PASS (현 직렬 구현도 동일 키 산출). 이 케이스는 회귀 가드 — 병렬화 후에도 동일해야 함을 고정한다.

- [ ] **Step 3: 병렬 구현으로 교체**

`src/lib/walk.ts`의 `walkDir`를 누적자 변형에서 반환형으로 교체:

```ts
async function walkDir(root: string, current: string): Promise<Upload[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (e): Promise<Upload[]> => {
      const abs = join(current, e.name);
      if (e.isDirectory()) return walkDir(root, abs);
      if (e.isFile()) {
        const s = await stat(abs);
        return [
          {
            key: relative(root, abs).split(sep).join("/"),
            absPath: abs,
            contentType: contentTypeFor(e.name),
            size: s.size,
          },
        ];
      }
      return [];
    }),
  );
  return nested.flat();
}
```

그리고 `collectUploads`의 호출부(현재 `const out: Upload[] = []; await walkDir(inputPath, inputPath, out);`)를:

```ts
  const out = await walkDir(inputPath, inputPath);
  if (out.length === 0) throw new Error(`Folder is empty: ${inputPath}`);
  return out;
```

- [ ] **Step 4: walk 테스트 전체 통과 확인**

Run: `npx vitest run test/walk.test.ts`
Expected: PASS (단일 파일 → index.html, 중첩 폴더, 깊은 트리, missing/empty throw 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/walk.ts test/walk.test.ts
git commit -m "perf: parallelize directory walk with per-level Promise.all (#19)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: publish 업로드 bounded 병렬화

**Files:**
- Modify: `src/commands/publish.ts` (import 추가, 모듈 상수 추가, 79-87 업로드 루프 교체)
- Test: `test/publish.test.ts` (fail-fast 케이스 추가)

**Interfaces:**
- Consumes: `mapLimit` (Task 1).
- Produces: `runPublish(args)` 동작 불변 — 반환 URL·meta·무효화 시맨틱 동일, 업로드만 병렬.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/publish.test.ts`의 `describe("runPublish", ...)` 안에 추가:

```ts
  it("writes no meta and does not invalidate when an upload fails", async () => {
    process.env.HOSTDOC_DOMAIN = "shared.example.com";
    process.env.HOSTDOC_DISTRIBUTION = "DIST1";
    // existing keys → overwrite path would invalidate on success
    s3mock.on(ListObjectsV2Command).resolves({
      KeyCount: 1,
      Contents: [{ Key: "doc1/index.html" }],
      IsTruncated: false,
    });
    s3mock.on(PutObjectCommand).rejects(new Error("network down"));
    writeFileSync(join(dir, "index.html"), "x");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "a.css"), "body{}");

    await expect(
      runPublish({ path: dir, slug: "doc1", force: true }),
    ).rejects.toThrow(/network down/);

    const puts = s3mock
      .commandCalls(PutObjectCommand)
      .map((c) => c.args[0].input.Key);
    expect(puts).not.toContain("_meta/doc1.json");
    expect(cfMock.commandCalls(CreateInvalidationCommand)).toHaveLength(0);

    delete process.env.HOSTDOC_DOMAIN;
    delete process.env.HOSTDOC_DISTRIBUTION;
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run test/publish.test.ts -t "writes no meta"`
Expected: FAIL — 현 직렬 루프도 첫 파일에서 throw하지만, 이 테스트는 병렬화 후에도 meta·무효화가 건너뛰어짐을 고정하는 회귀 가드다. 현 코드에서 이미 PASS일 수 있음 — PASS면 다음 단계에서 병렬화 후 여전히 PASS인지 확인(가드 유지). (Note: 직렬 구현에서 PASS여도 가드로 보존한다.)

- [ ] **Step 3: 업로드 루프를 `mapLimit`으로 교체**

`src/commands/publish.ts` 상단 import 블록에 추가:

```ts
import { mapLimit } from "../lib/concurrency.js";
```

import 블록 바로 아래 모듈 상수 추가:

```ts
const UPLOAD_CONCURRENCY = 8;
```

기존 79-87의 `for (const u of uploads) { await putObject(...); }`를 교체:

```ts
  await mapLimit(uploads, UPLOAD_CONCURRENCY, async (u) => {
    await putObject(
      s3,
      cfg.bucket,
      `${code}/${u.key}`,
      await readFile(u.absPath),
      u.contentType,
    );
  });
```

(meta 기록·무효화 블록은 그대로 — `await mapLimit(...)` 이후에 위치하므로 "모든 업로드 완료 후" 보장.)

- [ ] **Step 4: publish 테스트 전체 통과 확인**

Run: `npx vitest run test/publish.test.ts`
Expected: PASS (다수 파일 업로드, slug 거부, force, dry-run, 무효화, fresh 무무효화, 신규 fail-fast 케이스 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/commands/publish.ts test/publish.test.ts
git commit -m "perf: parallelize publish uploads with bounded concurrency (#19)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **전체 테스트**: `npm test` — 모든 스위트 PASS.
- [ ] **타입체크**: `npm run typecheck` — 0 에러 (`mapLimit` 제네릭·walk 반환형·publish 콜백 타입 정합).
- [ ] **빌드**: `npm run build` — `tsc`가 `dist/` 방출, 에러 0.

## Self-Review (작성자 확인 완료)

- **Spec coverage**: ① bounded 병렬 업로드 → Task 3 · ② walk 병렬화 → Task 2 · ③ meta/무효화 업로드 후 보장 → Task 3 Step 1 회귀 가드 + 코드 위치 유지 · ④ walk 키 산출 동일 → Task 2 (기존 sort 비교 + 깊은 트리 케이스). 비범위(롤백·env 설정·walk bound)는 플랜에 미포함 — 일치.
- **Placeholder scan**: TODO/TBD 없음. 모든 코드 스텝에 실제 코드 포함.
- **Type consistency**: `mapLimit<T,R>` 시그니처가 Task 1 정의 ↔ Task 3 사용에서 동일. `walkDir(root, current): Promise<Upload[]>` ↔ `collectUploads` 호출부 일치. `Upload` 필드(key/absPath/contentType/size) 기존과 동일.
