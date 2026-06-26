# Spec: rm/open이 기본 랜덤 코드(대문자 포함)를 거부하는 버그 수정

- **Issue**: [#33](https://github.com/jkas2016/hostdoc/issues/33)
- **Date**: 2026-06-26
- **Source**: #19 병렬 I/O 실서 검증(PR #32) 중 발견

## Problem

`hostdoc publish`를 slug 없이 실행하면 `generateCode()`가 **base62(대소문자+숫자) 7자
코드**를 만들어 `<host>/<code>/`에 게시한다. 그러나 `rm`/`open`은 인자 id를
**`isValidSlug`(소문자 전용)** 로 검증한다. 그 결과 대문자가 하나라도 든 기본 코드는
"Invalid id"로 거부되어 방금 게시한 문서를 CLI로 삭제하거나 열 수 없다.

코드는 62자 알파벳에서 7자이므로, 소문자/숫자(36자)만으로 구성될 확률은
`(36/62)^7 ≈ 0.022`. 즉 **기본 코드의 약 98%가 `rm`/`open`으로 관리 불가**하다. slug를
지정하면 회피되지만, 기본 경로(랜덤 코드)가 핵심 관리 명령에서 사실상 동작하지 않는다.
data-loss/보안 결함은 아니며 workaround(slug 지정, `aws s3 rm` 직접 삭제)는 존재한다.

### Root cause

- `src/lib/code.ts:3` — `ALPHABET = "0-9a-zA-Z"` (base62, 대소문자 혼합).
- `src/lib/code.ts:7` — `generateCode()`가 이 알파벳으로 코드 생성.
- `src/lib/code.ts:15` — `SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/` (소문자 전용).
- `src/commands/rm.ts:11` — `if (!isValidSlug(args.id)) throw new Error("Invalid id: ...")`.
- `src/commands/open.ts:9` — 동일한 `isValidSlug` 게이트.

slug 검증기를 **코드 검증에 재사용**한 것이 원인. slug(소문자+하이픈)와
code(대소문자+숫자)는 문자집합이 다르다.

## Goal

`rm`/`open`의 id는 **slug이거나 generated code**일 수 있으므로 둘의 합집합을 허용한다.
대문자 포함 코드로 `rm --yes`/`open`이 정상 동작하고, slug 경로는 그대로 동작하며,
`_meta`/예약 프리픽스 보호와 잘못된 id에 대한 명확한 거부는 유지한다.

## Approach (decided)

`src/lib/code.ts`에 별도의 `isValidCode(id)` 검증기를 추가하고, `rm`/`open` 게이트를
`isValidSlug(id) || isValidCode(id)` 합집합으로 바꾼다.

`isValidCode`는 **`/^[0-9A-Za-z]{1,63}$/`** (base62, 1~63자)로 정의한다. 검토한 대안:

- **정확히 7자 base62** (`/^[0-9A-Za-z]{7}$/`): 게시 가능한 id를 정밀 모델링하나 코드
  길이 7에 결합된다. `generateCode(len)`는 길이를 매개변수로 받으므로 결합을 피한다.
- **단일 union 정규식** (`/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/`): 코드는 가장 적으나
  'Foo-bar'(대문자+하이픈, slug도 code도 아닌) id까지 통과하고, 이슈의 2-검증기 설계와
  acceptance task와 어긋난다.

1~63자 base62를 택한 이유: slug의 1~63 길이와 대칭이고, `generateCode` 길이에 결합되지
않아 견고하며, 이슈가 1차로 제안한 형태와 일치한다. 생성될 수 없는 20자 대문자 문자열
등도 통과하지만, S3 키 프리픽스로 안전하고 `_meta` 보호를 깨지 않으므로 무해하다.

`isValidSlug`/`SLUG_RE`/`generateCode`는 변경하지 않는다 — publish의 slug 검증
(`src/commands/publish.ts:53`)은 소문자 전용을 유지해야 한다.

## Changes

### 1. `src/lib/code.ts` — `isValidCode` 추가

```ts
/** Generated codes: base62 (mixed case), 1–63 chars. No leading `_`, `/`, or space. */
export const CODE_RE = /^[0-9A-Za-z]{1,63}$/;

export function isValidCode(id: string): boolean {
  return CODE_RE.test(id);
}
```

`isValidSlug`/`SLUG_RE`/`generateCode`는 그대로 둔다.

### 2. `src/commands/rm.ts` · `src/commands/open.ts` — 게이트를 합집합으로

각 파일의 import에 `isValidCode`를 추가하고, 검증 게이트를 다음으로 교체한다.

```ts
if (!isValidSlug(args.id) && !isValidCode(args.id)) {
  throw new Error(`Invalid id: ${args.id}`);
}
```

에러 메시지, `_meta` 보호, 확인 프롬프트(`rm`), URL 빌드(`open`)는 변경하지 않는다.
`_meta`/`../escape`/공백/`/`/`#`/`?` 등은 `isValidSlug`·`isValidCode` 모두 거부하므로
예약 프리픽스 보호와 path-traversal 방어가 유지된다(선행 `_`는 `[0-9A-Za-z]`에 없어 거부).

## Test plan (TDD: tests first)

### `test/code.test.ts` — `isValidCode` describe 블록 신규

- accept: `"spinIYr"`(이슈 재현 코드), `"Abc123Z"`, `"7charXX"`, 순수 소문자/숫자
  (`"abc1234"`, `"doc1"`) — 대문자 포함 base62 코드가 통과함을 확인.
- reject: `""`, `"_meta"`(선행 `_`), `"a b"`(공백), `"a/b"`(슬래시), `"x#y"`, `"../escape"`,
  `"x".repeat(64)`(64자, 길이 초과) — 빈/특수문자/예약 프리픽스/과길이 거부.
- 기존 `isValidSlug`/`generateCode` 테스트는 그대로 둔다(`isValidSlug`는 여전히
  대문자를 거부해야 함 — `code.test.ts:22`의 `"UpperCase"` reject 케이스 유지).

### `test/rm.test.ts` — 대문자 코드 accept + 기존 reject 정정

- reject `it.each`(`rm.test.ts:80`)에서 **`"Doc1"` 제거** — `Doc1`은 이제 유효한 base62
  코드이므로 검증을 통과한다. 나머지(`_meta`, `../escape`, `a b`, `x/y`, `x?y`)는 유지.
- 신규 accept 케이스: 대문자 포함 코드(`"spinIYr"`)로 `runRm({ id, yes: true })`가
  `ListObjectsV2` → `DeleteObjects` 정상 경로를 타고 `<id>/...` + `_meta/<id>.json`을
  삭제함을 확인.

### `test/open.test.ts` — 대문자 코드 accept + 기존 reject 정정

- reject `it.each`(`open.test.ts:52`)에서 **`"Doc1"` 제거**. 나머지(`a b`, `../escape`,
  `x?y`, `x#y`, `_meta`)는 유지.
- 신규 accept 케이스: `resolveOpenUrl({ id: "spinIYr" })`가
  `http://b.s3-website-us-east-1.amazonaws.com/spinIYr/` URL을 정상 빌드함을 확인.

## Acceptance criteria (from issue)

- [ ] `hostdoc rm <대문자 포함 코드> --yes` 및 `hostdoc open <코드>`가 정상 동작.
- [ ] slug 경로(소문자·하이픈)도 기존대로 동작.
- [ ] `_meta`/예약 프리픽스 보호 유지, 잘못된 id는 여전히 명확한 에러로 거부.

## Non-goals

- `#21`의 `src/lib/code.ts:10` `% 62` 모듈로 편향(이 버그와 독립).
- `generateCode` 알고리즘/길이/알파벳 변경.
- `isValidSlug`/`SLUG_RE` 변경 또는 publish의 slug 검증 동작 변경.

## References

- `src/lib/code.ts` (`generateCode`, `SLUG_RE`, `isValidSlug`) · `src/commands/rm.ts`
  · `src/commands/open.ts`
- 유래: id 검증 도입 PR #22 ("validate rm/open id and gate rm behind a confirmation prompt").
- 관련: `#21`이 같은 `src/lib/code.ts`의 모듈로 편향을 별도로 다룸.
