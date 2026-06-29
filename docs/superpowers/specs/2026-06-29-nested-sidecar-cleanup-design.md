# Spec: 중첩 prefix 삭제/덮어쓰기 시 중첩 사이드카 정리

- **Issue**: [#37](https://github.com/jkas2016/hostdoc/issues/37)
- **Date**: 2026-06-29
- **Branch**: `fix/37-nested-sidecar-cleanup`

## Problem

#7(중첩 경로)에서 명시적으로 **범위 밖**으로 미뤄둔 후속 버그다. (#7 스펙 Risks 표
마지막 행)

`publish`/`rm`은 목적지를 단일 prefix `${code}/`로 다루고, 메타 사이드카 키는
`metaKey(code)` = `_meta/${code}.json`으로 파생한다. 중첩 경로가 허용되면서
**최상위 문서와 중첩 문서가 부모 prefix를 공유**할 수 있다:

- `publish ./parent --slug team` → 콘텐츠 `team/*`, 사이드카 `_meta/team.json`
- `publish ./child --slug team/q1/report` → 콘텐츠 `team/q1/report/*`,
  사이드카 `_meta/team/q1/report.json`

`publish --slug team --force`(또는 `rm team`)는 **prefix `team/`** 에 작용하므로 중첩
자식의 콘텐츠 `team/q1/report/*`까지 재귀 삭제한다. 그러나 사이드카 정리는
`_meta/team.json`만 제거하고 중첩 자식의 `_meta/team/q1/report.json`은 **남긴다**.

**결과**: 자식의 콘텐츠 객체는 사라졌는데 사이드카는 생존 → **고아 사이드카**.

**사용자 노출 증상**: `list`는 `_meta/**` 사이드카를 모두 읽어 각 행의 URL을
`meta.code`로 만든다. 고아 `_meta/team/q1/report.json`이 **죽은 URL(콘텐츠 없음 →
s3-website 404 / cloudfront 403→404)을 가진 stale `list` 행**으로 계속 노출되고, 자가
치유되지 않는다.

선재 prefix-delete 시맨틱이 중첩 경로로 표면화된 것이며 #7의 회귀는 아니다. 심각도는
낮다 — `--force`(또는 `rm`)를 별도로 발행된 중첩 자식이 있는 부모 prefix에 실행해야만
재현되는 드문 레이아웃이다.

## Goal

prefix `P/`의 콘텐츠를 삭제하는 모든 경로(`rm P`, `publish P --force`)가 `P/` 아래 사는
문서들의 사이드카(`_meta/P/**`)도 함께 삭제한다. 즉 **사이드카 수명이 콘텐츠 수명과
일치**한다. 고아 사이드카가 생성되지 않으므로 `list`에 죽은 행이 남지 않는다.

비목표: 이미 사용자 버킷에 존재하는 기존 고아의 일괄 치유(다음 `rm`/`--force`에서 자연
정리됨), `list` 시점 자가 치유, 조상-prefix 발행 거부. (브레인스토밍에서 접근법 A만
채택 — B/C 제외.)

## Key Insight (왜 변경이 작고 정확한가)

`P/` 아래로 콘텐츠가 들어가는 모든 문서는 그 `code`가 **`P/`로 시작**한다. 그 문서들의
사이드카는 `metaKey(code)` = `_meta/${code}.json`이므로 정확히 **`_meta/P/`로 시작**한다.
따라서:

```
listKeys(s3, bucket, `_meta/${P}/`)   // P 아래 사는 모든 문서의 사이드카를 정확히 집어냄
```

S3 prefix 매칭 한 번이 고아 후보 전체를, **오탐 없이** 열거한다. 형제 `teamfoo`의
사이드카 `_meta/teamfoo.json`은 `_meta/team/` prefix에 매칭되지 않는다(다음 글자가 `.`,
`/` 아님) — 콘텐츠 `teamfoo/*`가 `team/` prefix 삭제에 걸리지 않는 것과 정확히 대칭.

## Decisions

### D1. 사이드카 키 파생은 `meta.ts`에 단일 소유 — 헬퍼 추가

`metaKey(code)`의 형제로 `nestedMetaPrefix(code)`를 `src/lib/meta.ts`에 추가한다.
사이드카 키 규칙(`_meta/...`)을 한곳에 유지한다.

```ts
// src/lib/meta.ts (metaKey 옆)
export function nestedMetaPrefix(code: string): string {
  return `_meta/${code}/`; // code 아래 사는 모든 문서의 사이드카 prefix
}
```

### D2. `rm`: 중첩 사이드카를 함께 삭제

`src/commands/rm.ts` — 콘텐츠 열거 후 중첩 사이드카도 열거해 삭제 목록에 합친다.

```ts
const content = await listKeys(s3, cfg.bucket, `${args.id}/`);
if (content.length === 0) throw new Error(`Document not found: ${args.id}`);
// ...확인 프롬프트(파일 수는 content 기준 유지)...
const nestedMeta = await listKeys(s3, cfg.bucket, nestedMetaPrefix(args.id));
await deleteKeys(s3, cfg.bucket, [...content, metaKey(args.id), ...nestedMeta]);
```

- not-found 판정·확인 프롬프트 파일 수는 **콘텐츠 기준 유지** (사이드카는 사용자에게
  보이지 않는 내부 객체).
- 자기 사이드카 `_meta/${id}.json`은 `metaKey(id)`로, 중첩 자식 사이드카는
  `nestedMetaPrefix(id)`로 — 경계가 `.json` vs `/`라 **중복 없음**.

### D3. `publish --force`: 중첩 사이드카를 함께 삭제

`src/commands/publish.ts` `--force` 덮어쓰기 블록에 중첩 사이드카 삭제를 추가한다.

```ts
if (args.force) {
  const existing = await listKeys(s3, cfg.bucket, `${code}/`);
  if (existing.length) {
    const nestedMeta = await listKeys(s3, cfg.bucket, nestedMetaPrefix(code));
    await deleteKeys(s3, cfg.bucket, [...existing, ...nestedMeta]);
    overwritten = true;
  }
}
```

- 자기 사이드카 `_meta/${code}.json`은 **건드리지 않는다** — 직후 `putObject`로 같은 키에
  재기록되기 때문. 중첩 자식 사이드카만 정리하면 충분.
- `nestedMeta` 비어있지 않음 ⟹ 해당 콘텐츠가 `code/` 아래 존재 ⟹ `existing.length > 0`.
  따라서 기존 `if (existing.length)` 가드 안에 둬도 누락 없음.

### D4. CloudFront 무변경

사이드카는 서빙되지 않고(`infra/index-rewrite.js`가 `/_*` 403), 콘텐츠 무효화
`/${code}/*`가 이미 중첩 경로(`/team/q1/report/*`)를 덮는다. 사이드카 삭제는 추가
invalidation을 요구하지 않는다.

## 불변식

> prefix `P/`의 콘텐츠를 삭제하면 `P/` 아래 사는 모든 문서의 사이드카(`_meta/P/**`)도
> 삭제된다. `rm`은 자기 사이드카(`_meta/P.json`)까지 삭제하고, `publish --force`는 자기
> 사이드카를 재기록한다.

## 검증한 엣지 케이스

| 케이스 | 동작 |
|---|---|
| 형제 `teamfoo` (rm `team`) | `_meta/team/` prefix 미매칭 → 사이드카·콘텐츠 무손상 |
| 자식 없는 leaf (`rm doc1`) | `listKeys(_meta/doc1/)` 빈 배열 → 기존 동작과 동일 |
| 중첩 rm `team/q1` | 자기 `_meta/team/q1.json`(metaKey) + `_meta/team/q1/**`(prefix), `.json` vs `/` 경계로 중복 없음 |
| 다층 자식 (rm `team`, `team/q1` + `team/q1/report` 둘 다 존재) | 둘의 사이드카 모두 `_meta/team/` 아래 → 함께 삭제 |
| dry-run | 삭제 경로 진입 전 반환 — 무변경 |

## 테스트 플랜 (TDD — 테스트 먼저)

### `test/meta.test.ts`
- `nestedMetaPrefix("team")` === `"_meta/team/"`
- `nestedMetaPrefix("team/q1/report")` === `"_meta/team/q1/report/"`

### `test/rm.test.ts`
- **부모 prefix rm**: `rm team` 시 DeleteObjects에 콘텐츠 `team/*` + `_meta/team.json` +
  중첩 `_meta/team/q1/report.json` 포함. `ListObjectsV2Command`를 **Prefix별로 모킹** —
  `team/` → 콘텐츠 키, `_meta/team/` → `[_meta/team/q1/report.json]`.
- **leaf 회귀**: `rm doc1` 시 `_meta/doc1/` 리스트가 빈 배열 → 콘텐츠 + `_meta/doc1.json`만
  삭제(기존 동작 보존).
- **오탐 방지**: Prefix-scoped 모킹으로 `_meta/teamfoo.json`이 삭제 목록에 절대 포함되지
  않음(중첩 리스트가 형제를 반환하지 않음).

### `test/publish.test.ts`
- **force가 중첩 사이드카 정리**: `publish team --force`가 기존 콘텐츠 + 중첩
  `_meta/team/q1/report.json`을 DeleteObjects하고 `_meta/team.json`을 재기록(PutObject).
- **자식 없는 force 회귀**: 중첩 사이드카 없을 때 기존 동작 유지(중첩 사이드카 삭제 없음).

### 기존 테스트 조정
일부 기존 테스트가 제네릭 `.on(ListObjectsV2Command).resolves(...)`로 모든 리스트 호출에
같은 응답을 준다. 변경 후 rm/force는 콘텐츠와 `_meta/code/` **두 번** 리스트하므로, 해당
테스트들을 **Prefix-scoped 모킹**으로 조정해 두 번째(`_meta/code/`) 호출이 콘텐츠 키를
반환하지 않게 한다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/meta.ts` | `nestedMetaPrefix(code)` 추가 |
| `src/commands/rm.ts` | 중첩 사이드카 열거·삭제 |
| `src/commands/publish.ts` | `--force` 블록에 중첩 사이드카 열거·삭제 |
| `test/meta.test.ts` | `nestedMetaPrefix` 단위 테스트 |
| `test/rm.test.ts` | 중첩 사이드카 정리·회귀·오탐 테스트 (Prefix-scoped 모킹) |
| `test/publish.test.ts` | `--force` 중첩 사이드카 정리·회귀 테스트 |
| `docs/superpowers/specs/2026-06-29-nested-custom-paths-design.md` | Risks 표 마지막 행을 "#37에서 해결"로 갱신 |

## References

- `src/commands/rm.ts` (`listKeys(prefix)` + `metaKey`)
- `src/commands/publish.ts` (`--force` 덮어쓰기 delete)
- `src/commands/list.ts` (`listKeys("_meta/")` → `meta.code`로 URL)
- `src/lib/meta.ts` (`metaKey`, 신규 `nestedMetaPrefix`)
- #7 스펙: `docs/superpowers/specs/2026-06-29-nested-custom-paths-design.md` (Risks 표 마지막 행)
