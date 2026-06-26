# 독립 I/O 병렬화 (publish 업로드·walk) — 설계

- **이슈**: #19 `[Enhancement] 성능: 독립 I/O 병렬화 (publish 업로드·walk)`
- **출처**: `deep-code-review` (2026-06-23)
- **작성일**: 2026-06-26
- **우선순위**: medium

## 배경 / 문제

서로 의존이 없는 I/O가 루프에서 하나씩 `await`되어 처리량이 항목 수 × 지연으로 선형 증가한다.

- **`src/commands/publish.ts:79-87`** (important) — 파일별 업로드가 `for...of`에서 직렬 await. `await readFile` → `await putObject`가 모두 직렬이라 N개 파일 폴더에서 총 시간이 N × (읽기 + RTT).
- **`src/lib/walk.ts:12-29`** (minor) — `walkDir`가 항목마다 직렬 await해 독립적인 하위 디렉터리 재귀와 `stat`을 직렬화. 크고 깊은 트리에서 모든 fs I/O가 직렬.

## 목표 (수용 기준)

- 다수 파일 폴더 publish가 **동시성 제한을 둔** 병렬 업로드로 동작한다.
- meta 기록·CloudFront 무효화는 **모든 업로드 완료 후에만** 실행됨을 보장한다.
- walk가 병렬화되어도 키/상대경로 산출(집합)이 동일하다 — 기존 테스트 유지.

## 설계 결정 (브레인스토밍 확정)

1. **동시성 한도 = 고정 상수 8.** 설정 노출(env/flag) 없음(YAGNI — 이슈가 요구하지 않음). 8은 AWS CLI S3 전송 기본값 `max_concurrent_requests = 10`([공식 문서](https://docs.aws.amazon.com/cli/latest/topic/s3-config.html)) 범위 내 보수값.
2. **업로드만 bounded, walk는 무제한 레벨 병렬.** 네트워크 I/O(업로드)는 풀파일 버퍼 + 소켓이라 한도가 필요. fs I/O(walk)는 Node libuv 스레드풀(기본 4)이 syscall 동시성을 자연 throttle하므로 레벨별 `Promise.all`로 충분(이슈가 walk를 minor·단순 `Promise.all`로 명시).
3. **부분 실패 롤백 없음.** fail-fast 시 부분 업로드 잔존 가능성은 현 직렬 동작과 동일 — 동작 보존이 원칙.

### 비용·자원 영향 (확인 완료)

- **비용 불변.** 청구는 수량 기준(요청 수·바이트·무효화 수)이며 동시성과 무관. 파일당 PUT 1번은 직렬/병렬 동일하고("charged on the quantity of requests"), S3 인바운드 전송은 무료("Data transferred in from the internet") — [S3 pricing](https://aws.amazon.com/s3/pricing/). 동시성 8은 단일 prefix 한도 3,500 PUT/s에 한참 못 미쳐 throttle 재시도도 없음.
- **디바이스 부하 무시 가능.** `readFile`를 태스크 내부에 둬 피크 메모리가 폴더 전체가 아닌 동시 ≤8개 파일로 묶임. fd/소켓 ≤8, CPU는 I/O 대기라 유휴. walk의 fs ops는 libuv 스레드풀(4)이 자연 제한.

## 컴포넌트

### 1) `src/lib/concurrency.ts` (신규)

```ts
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]>;
```

- 동시 실행 ≤ `limit`. 커서 기반 워커 풀: `min(limit, items.length)`개 워커가 공유 커서에서 다음 인덱스를 당겨 처리.
- **결과 순서 보존**: `results[i]`는 `items[i]`의 결과.
- **fail-fast**: 첫 reject 발생 시 새 작업 스케줄을 중단하고 그 에러로 reject. 이미 in-flight인 태스크는 settle되나 결과는 무시.
- 경계: 빈 배열 → `[]`; `limit <= 0` 또는 `limit >= n` 안전 클램프.

### 2) `src/lib/walk.ts` (수정)

`walkDir`의 누적자(`out: Upload[]` 파라미터)를 제거하고 반환형으로 변경:

```ts
async function walkDir(root: string, current: string): Promise<Upload[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (e) => {
    const abs = join(current, e.name);
    if (e.isDirectory()) return walkDir(root, abs);
    if (e.isFile()) {
      const s = await stat(abs);
      return [{
        key: relative(root, abs).split(sep).join("/"),
        absPath: abs,
        contentType: contentTypeFor(e.name),
        size: s.size,
      }];
    }
    return [];
  }));
  return nested.flat();
}
```

`collectUploads`는 `const out = await walkDir(inputPath, inputPath);`로 호출. 엔트리를 `readdir` 순서대로 `flat()`하므로 직렬판과 **출력 순서까지 동일**(단일 파일·빈 폴더 분기는 불변).

### 3) `src/commands/publish.ts` (수정, 79-87)

```ts
const UPLOAD_CONCURRENCY = 8; // module-level const

await mapLimit(uploads, UPLOAD_CONCURRENCY, async (u) => {
  await putObject(
    s3,
    cfg.bucket,
    `${code}/${u.key}`,
    await readFile(u.absPath), // 태스크 내부 유지 → 동시 ≤8개만 버퍼링
    u.contentType,
  );
});
```

meta 기록(`putObject(metaKey...)`)과 무효화 블록은 **`await mapLimit(...)` 이후 그대로 유지** → "모든 업로드 완료 후" 보장. `src/lib/aws.ts`(`putObject` 등)는 **무변경**.

## 데이터 흐름 / 순서 보장

```
collectUploads (walk 병렬, 순서 보존)
  → mapLimit 업로드 (bounded 8, 완료까지 await)   ← 1건이라도 실패 시 reject
  → putObject(meta)                               ← 업로드 전부 성공 후에만 도달
  → invalidate (cloudfront + overwrite 시)
  → buildPublicUrl
```

## 에러 처리

mapLimit fail-fast → 업로드 1건 실패 시 즉시 전파되어 `runPublish`가 throw, meta 미기록·무효화 미실행. 부분 업로드 잔존은 현 직렬 동작과 동일(비범위).

## 테스트 계획 (먼저 작성)

### `test/concurrency.test.ts` (신규)

1. 결과 순서 보존 (`results[i] === fn(items[i])`).
2. 동시 실행이 `limit`을 초과하지 않음 — deferred gate + 활성 카운터로 피크 동시성 계측.
3. 첫 reject가 전파됨.
4. reject 이후 후속 인덱스의 `fn`이 호출되지 않음(스케줄 중단).
5. limit 클램프: `limit = 1`(직렬), `limit >= n`.
6. 빈 배열 → `[]`.

### `test/walk.test.ts` (확장)

- 기존 케이스 유지(단일 파일 → index.html, 중첩 폴더 키 집합, missing/empty throw).
- 깊은 중첩 트리(≥3 레벨) 키 집합 동일 케이스 추가.

### `test/publish.test.ts` (확장, aws-sdk-client-mock)

- 다수 파일 전부 PutObject + 올바른 `<code>/<key>`·Content-Type.
- 업로드 1건 reject 시: meta(`_meta/<code>.json`) PutObject 미발생, CloudFront invalidate 미호출.
- 동시성 도입 후에도 반환 URL 불변.

## 비범위

- walk의 한도형 동시성(깊은 트리 fs bound).
- 부분 업로드 롤백/정리.
- 동시성 설정 노출(env/flag) — 추후 필요 시 별도 이슈.

## 참고

- `src/commands/publish.ts` · `src/lib/walk.ts` · `src/lib/aws.ts`(`putObject`)
- [AWS CLI S3 config — max_concurrent_requests](https://docs.aws.amazon.com/cli/latest/topic/s3-config.html)
- [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)
