# Spec: 중첩/다중 세그먼트 커스텀 경로 지원 (publish/rm/open)

- **Issue**: [#7](https://github.com/jkas2016/hostdoc/issues/7)
- **Date**: 2026-06-29
- **Branch**: `feat/7-nested-paths`

## Problem

`publish --slug <name>`은 **단일** 세그먼트 커스텀 경로만 지원한다. slug 검증기
`SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/` (`src/lib/code.ts`)가 `/`를 거부하므로
`team/q1/report` 같은 **중첩/다중 세그먼트 경로**로 발행할 수 없다.

추가로, `rm`/`open` 명령어도 id를 `isValidSlug`/`isValidCode`로 검증하는데 둘 다 `/`를
거부한다. 즉 중첩 경로를 publish만 허용하면 그 문서를 **삭제·열기 불가**한 반쪽짜리
기능이 된다. (`open.ts`의 `openPublishedUrl`은 URL에서 마지막 세그먼트 하나만 추출하는
버그도 있어 중첩 경로에서 깨진다.)

## Goal

`hostdoc publish ./x --slug team/q1/report`가 두 호스팅 모드 모두에서
`<host>/team/q1/report/`로 콘텐츠를 서빙한다. 메타 사이드카·CloudFront invalidation이
전체 중첩 prefix를 타깃한다. `rm`/`open`도 중첩 경로 id를 일급으로 받는다. traversal·빈
세그먼트·`_`-시작 세그먼트는 명확한 에러로 거부되고 `_meta/` 보호는 유지된다.

## Key Insight (왜 변경이 작은가)

1. **`code` 변수가 이미 균일하게 흐른다.** publish/rm/open 전반에서 prefix는 항상
   `${code}/`, 사이드카는 `metaKey(code)`, URL은 `buildPublicUrl(cfg, code)`,
   invalidation은 `/${code}/*`. `code`에 `/`를 허용하기만 하면 대부분 자동 동작한다.
2. **`SLUG_RE`의 첫 글자 규칙이 모든 거부 요건을 이미 인코딩한다.** `^[a-z0-9]` 시작 +
   1–63자 규칙이 세그먼트별로 다음을 자동 거부한다:
   - `..`, `.` (점으로 시작 → 첫 글자 규칙 위반) → **traversal 거부**
   - `_meta` 등 `_`-시작 → **`_meta/` 보호 유지**
   - `""` 빈 세그먼트(`//`, leading/trailing `/`에서 발생) → **빈 세그먼트 거부**
   - 64자+ 세그먼트 → 길이 초과 거부
   따라서 별도 traversal/`_`/빈 세그먼트 로직 없이 **세그먼트별 `SLUG_RE` 검증만으로
   충분**하다.

## Decisions

- **메타 사이드카 키: 중첩 키 (A).** `metaKey("team/q1/report")` →
  `_meta/team/q1/report.json`. `metaKey`가 이미 템플릿 리터럴이라 무변경.
  `list`는 `listKeys("_meta/")`가 재귀적이고 URL을 `meta.code` 필드로 만들므로 중첩 키여도
  자동 동작. 평면 인코딩 키(B)는 인코딩/디코딩만 추가될 뿐 이점이 없어 기각.
- **검증 함수: `isValidSlug` 제거, `isValidPath`로 대체.** `isValidPath`는 단일 세그먼트를
  기존 `isValidSlug`와 동일하게 처리하는 **상위집합**이다. 3개 호출부(publish/rm/open)를
  모두 `isValidPath`로 바꾸면 `isValidSlug`는 고아가 되므로 제거한다(내 변경이 만든
  orphan만 정리). `SLUG_RE`는 `isValidPath`가 계속 사용하므로 유지.
- **`_meta/` 보호는 추가 작업 불필요.** s3-website는 `NotResource: .../_meta/*`(IAM `*`는
  `/` 포함 매칭), cloudfront는 `/_*` 403. 둘 다 중첩 `_meta/team/q1/report.json`을 자동
  커버한다. 인프라 변경 없음.

## Changes

### 1. `src/lib/code.ts` — `isValidSlug` 제거, `isValidPath` 추가

```ts
/** Multi-segment publish path: each "/"-separated segment must match SLUG_RE. */
export function isValidPath(path: string): boolean {
  return path.split("/").every((seg) => SLUG_RE.test(seg));
}
```

`SLUG_RE`가 세그먼트별로 빈/`.`/`..`/`_`-시작/63자 초과를 자동 거부한다. `isValidSlug`는
삭제(아래 호출부 교체로 고아화).

| 입력 | 결과 | 근거 |
|---|---|---|
| `team/q1/report` | ✅ | 각 세그먼트 통과 |
| `report` | ✅ | 단일 세그먼트(기존 slug와 동일) |
| `team//q1` | ❌ | `["team","","q1"]` → `""` 거부 |
| `/team` · `team/` | ❌ | leading/trailing → `""` 거부 |
| `../etc` | ❌ | `..` 첫 글자 규칙 위반 |
| `team/_x` | ❌ | `_x` 첫 글자 규칙 위반 |
| `""` | ❌ | `[""]` → `""` 거부 |
| `team/<64자>` | ❌ | 세그먼트 길이 초과 |

### 2. `src/commands/publish.ts` — 검증만 교체

- `import { generateCode, isValidSlug }` → `isValidPath`.
- `if (!isValidSlug(args.slug))` → `if (!isValidPath(args.slug))`.
- 에러 메시지에 중첩 경로 허용을 반영:
  > `Invalid slug "...". Use lowercase letters, digits, and hyphens per path segment (each segment must start alphanumeric); "/" separates nested segments.`
- 나머지(`existsPrefix(`${args.slug}/`)`, `code = args.slug`,
  `listKeys(`${code}/`)`, overwrite delete, `metaKey(code)`,
  `buildPublicUrl(cfg, code)`, invalidation `/${code}/*`)는 **무변경** — `code` 균일
  흐름으로 자동 동작.

### 3. `src/commands/rm.ts` — 검증만 교체

- `import { isValidSlug, isValidCode }` → `isValidPath, isValidCode`.
- `if (!isValidSlug(args.id) && !isValidCode(args.id))` →
  `if (!isValidPath(args.id) && !isValidCode(args.id))`.
- 나머지(`listKeys(`${args.id}/`)`, `metaKey(args.id)`, invalidation `/${args.id}/*`)는
  무변경.

### 4. `src/commands/open.ts` — 검증 교체 + `openPublishedUrl` 버그 수정

- `import { isValidSlug, isValidCode }` → `isValidPath, isValidCode`.
- `resolveOpenUrl`: `isValidSlug` → `isValidPath`.
- **`openPublishedUrl` 수정**: 현재
  ```ts
  const id = url.split("/").slice(-2, -1)[0]; // 마지막 세그먼트 1개만 → 중첩에서 깨짐
  ```
  를 전체 path 추출로 교체:
  ```ts
  const id = new URL(url).pathname.replace(/^\/+|\/+$/g, ""); // team/q1/report
  ```
  `buildPublicUrl`이 `https://<host>/team/q1/report/`를 만들므로 pathname 파싱이 정확한
  역연산이다.

### 5. 무변경 확인 (`url.ts`·`meta.ts`·`walk.ts`·`infra/index-rewrite.js`)

- `url.ts`: `buildPublicUrl`이 `/${code}/` → `https://host/team/q1/report/`. 슬래시는
  의도된 경로 구분자이므로 인코딩하지 않는다. 무변경.
- `meta.ts`: `metaKey`는 템플릿 리터럴, `buildMeta`는 `slug`에 전체 경로 문자열 저장. 스키마
  변경 없음. 무변경.
- `walk.ts`: 단일 파일 → `index.html`, 폴더 → 트리. prefix와 무관. 무변경.
- `infra/index-rewrite.js`: 이미 중첩 trailing-slash/extensionless URI에 `index.html`을
  부착하고 `/_*`를 403 처리. 무변경(테스트로 확인).

## Test Plan (TDD — 테스트 먼저)

AWS는 `aws-sdk-client-mock`으로 모킹. 상태는 `HOSTDOC_*` env로 주입(기존 패턴).

### `test/code.test.ts` — `isValidPath`
- 통과: `team/q1/report`, `report`(단일), `a/b`, 63자 단일 세그먼트.
- 거부: `team//q1`, `/team`, `team/`, `../etc`, `team/..`, `.`, `team/_x`, `_meta/x`, `""`,
  64자 세그먼트, 대문자 포함 세그먼트.
- `isValidSlug` describe 블록은 `isValidPath`로 마이그레이션(삭제된 함수 참조 제거).

### `test/publish.test.ts` — 중첩 publish
- `--slug team/q1/report` → 업로드 키 `team/q1/report/<rel>`, 사이드카
  `_meta/team/q1/report.json`, URL:
  - s3-website 모드: `http://<bucket>.s3-website...amazonaws.com/team/q1/report/`
  - cloudfront 모드: `https://<domain>/team/q1/report/`
- 단일 파일 → `team/q1/report/index.html`.
- 충돌: 기존 `team/q1/report/` 존재 + `--force` 없음 → 에러. `--force` → nested prefix
  delete 후 재업로드.
- cloudfront + overwrite → invalidation `/team/q1/report/*` 호출.
- 거부: `--slug team/_x` · `--slug ../etc` · `--slug a//b` → 명확한 에러, 업로드 0.

### `test/rm.test.ts` — 중첩 rm
- `rm team/q1/report --yes` → `listKeys("team/q1/report/")` 삭제 + 사이드카
  `_meta/team/q1/report.json` 삭제 + (cloudfront) invalidation `/team/q1/report/*`.
- 존재하지 않는 중첩 경로 → "Document not found".

### `test/open.test.ts` + `test/publish-open.test.ts` — 중첩 open
- `test/open.test.ts`: `open team/q1/report` → 양 모드 nested URL 생성(`resolveOpenUrl`).
- `test/publish-open.test.ts`: `openPublishedUrl("https://host/team/q1/report/")` → id
  `team/q1/report` 추출 후 동일 nested URL(현재 마지막-세그먼트-1개 버그의 회귀 테스트).

### `test/index-rewrite.test.ts` (기존 파일) — nested 케이스 추가
- `/team/q1/report/` → `index.html` 부착, `/team/q1/report`(extensionless) →
  `/index.html` 부착, `/_meta/team/x.json` → 403.

## Docs

- `README.md`: `--slug` 설명에 중첩 경로 예시 추가 (`--slug team/q1/report` →
  `<host>/team/q1/report/`).
- 가이드 사이트: publish 예시 섹션에 동일 예시 1줄 추가.

## Non-goals

- `<prefix>/` 모델을 우회하는 임의 절대 객체 키.
- 기본 랜덤 코드 동작 변경.
- 예약된 `_meta/` prefix 하위 쓰기 허용.

## Risks

| 리스크 | 완화 |
|---|---|
| traversal(`..`/`.`)이 prefix를 탈출 | `SLUG_RE` 첫 글자 규칙이 세그먼트별 자동 거부 |
| `_`-시작 세그먼트가 `_meta/` 보호와 충돌 | `SLUG_RE` 첫 글자 규칙이 자동 거부 |
| `//`·leading/trailing `/`의 빈 세그먼트 | split 후 `""`가 `SLUG_RE` 불통과로 거부 |
| `openPublishedUrl`이 중첩 경로에서 마지막 세그먼트만 추출 | URL `pathname` 파싱으로 전체 경로 복원 |
| **(범위 밖)** `--force`로 부모 prefix(`team`) 발행 시 nested 자식(`team/q1/report/*`)도 삭제되나 `_meta/team.json`만 제거 → nested 사이드카 고아 | 기존 prefix-delete 시맨틱. **#37에서 해결** — prefix 삭제/덮어쓰기 시 `_meta/<prefix>/**` 중첩 사이드카도 함께 삭제 (spec: `2026-06-29-nested-sidecar-cleanup-design.md`). |

## References

- `src/lib/code.ts` (`SLUG_RE`, `isValidSlug`→`isValidPath`)
- `src/commands/publish.ts` · `src/commands/rm.ts` · `src/commands/open.ts`
- `src/lib/url.ts` (`buildPublicUrl`) · `src/lib/meta.ts` (`metaKey`) · `src/lib/walk.ts`
- `src/commands/setup.ts:68` (`NotResource: .../_meta/*`) · `infra/index-rewrite.js` (`/_*` 403)
