# PRD — Notion 주기 Polling Remote Workflow (GitHub Actions)

## 0. 개요
- 목적: Notion 지정 Database를 주기적으로(스케줄) 또는 원격 수동 호출(workflow_dispatch)로 폴링하여 변경된 페이지만 MDX로 변환·저장하고, 변경이 있으면 리포지토리에 자동 커밋/푸시(또는 브랜치→PR)하여 정적 사이트(예: Vercel)가 최신 상태를 유지하도록 한다.
- 범위: GitHub Actions 워크플로, Node.js 동기화 스크립트(check-and-sync.js), 상태 파일(.notion-sync/state.json), 결과물 저장 디렉토리(posts/ 기본), 사용/운영 가이드(README_NOTION_SYNC.md).
- 비범위(Out of Scope): 사이트 빌드/배포 파이프라인 자체, 이미지 재호스팅 구현(옵션으로 방향성만), 복잡한 콘텐츠 변환 규칙(기본은 notion-to-md 기반).

---

## 1. 핵심 요구사항
- 주기 폴링과 원격 실행 지원: schedule(cron, 예: 10분) 및 workflow_dispatch 입력으로 실행 가능.
- 입력 파라미터(override 허용):
  - poll_interval_minutes (integer, optional) — 조회 간격 계산용(디버깅/수동 override)
  - notion_db_id (string, optional) — 기본은 repo secret
  - notion_token (string, optional) — 기본은 repo secret, 입력은 디버깅용만 권장
  - mdx_dest_path (string, optional, default: `posts/`)
  - commit_mode (string, optional, default: `branch`) — `main` 또는 `branch`
  - branch_name (string, optional) — branch 모드에서 사용
- 민감정보: 기본적으로 Repository Secrets 사용 (NOTION_TOKEN, NOTION_DB_ID, GITHUB_TOKEN, (옵션) CDN_* 등). 입력으로 시크릿 전달은 허용하되 권장하지 않음.
- 증분 처리: Notion page의 `last_edited_time` + 콘텐츠 `content_hash`로 변경 여부 판단.
- 상태관리: `.notion-sync/state.json` 파일을 리포에 커밋하여 다음 실행 시 기준으로 사용.
- 로컬/CI 테스트: `act`로 로컬 시뮬레이션 가능, Node 단독 실행도 가능.

---

## 2. 성공 기준 (Acceptance Criteria)
1) 워크플로가 스케줄(예: 10분) 또는 수동(workflow_dispatch)으로 정상 실행·종료한다.
2) 초기 실행 시 Notion DB의 모든 포스트가 `mdx_dest_path`에 MDX로 생성되고 `.notion-sync/state.json`이 업데이트·커밋된다.
3) Notion에서 특정 페이지를 수정하면 다음 실행에서 해당 MDX만 업데이트되고 실제로 커밋/푸시(또는 브랜치+PR)가 발생한다.
4) 동일 내용으로 재실행 시 중복 커밋이 발생하지 않는다(해시 비교로 방지).
5) 입력(`mdx_dest_path`, `notion_db_id`, `poll_interval_minutes`)으로 동작을 변경 가능하다.
6) `act`로 로컬 실행이 가능하고, 지정된 테스트 케이스(초기/수정/중복/override/실패)가 재현된다.

---

## 3. 아키텍처 / 흐름 (High-level)
1) GitHub Actions 워크플로가 스케줄 또는 `workflow_dispatch`로 트리거된다.
2) 워크플로가 `scripts/check-and-sync.js`(Node.js)를 실행한다:
   - `.notion-sync/state.json` 로드 → `since` 계산(`last_run` 또는 입력 `poll_interval_minutes`) → Notion DB 쿼리(`last_edited_time > since`)
   - 변경 식별된 페이지마다 `retrieve` + `blocks` fetch → MDX 변환(Notion → Markdown/MDX with frontmatter)
   - MDX 본문에 대한 `content_hash` 계산 → 기존 `state`의 페이지 항목과 비교 → 변경 시 파일 쓰기 및 `state` 업데이트
3) 변경 파일이 1개 이상이면 git add/commit/push 수행. `commit_mode = branch` 인 경우 브랜치 생성 → 커밋 → push → PR 생성(옵션).
4) 워크플로 종료 시 변경 여부에 따라 repo 상태가 반영된다.

---

## 4. Deliverables (파일/리소스)
- `scripts/check-and-sync.js` — 메인 동기화 스크립트 (Node.js; 환경변수/inputs 읽기)
- `package.json` — 필요한 deps(@notionhq/client, notion-to-md, slugify, p-limit, p-retry 등) 및 npm scripts
- `.notion-sync/state.json` — 상태 파일 (초기 빈 구조 포함)
- `.github/workflows/notion-poll-sync.yml` — 워크플로 정의 (schedule + workflow_dispatch)
- `posts/` — 변환된 `<slug>.mdx` 저장 디렉토리 (기본)
- `README_NOTION_SYNC.md` — 설치·테스트·운영 가이드(act 사용법 포함)
- `tests/` (선택) — 단위/간단 e2e (예: hash 비교, 변환 스냅샷)

---

## 5. 상태 파일 스펙 (.notion-sync/state.json)
```json
{
  "last_run": "2025-09-15T10:00:00.000Z",
  "pages": {
    "notion-page-id-1": {
      "slug": "example-post",
      "last_edited_time": "2025-09-14T12:34:56.000Z",
      "content_hash": "sha256-..."
    }
  }
}
```
- `last_run`: 마지막 실행 시각(ISO, UTC)
- `pages`: 페이지별 상태(키는 Notion Page ID). 각 항목에 slug, last_edited_time, content_hash를 저장

---

## 6. 입력/환경변수 (주입 우선순위)
- Inputs (workflow_dispatch)
  - `poll_interval_minutes` (default: 15)
  - `notion_db_id` (optional — fallback: secret `NOTION_DB_ID`)
  - `notion_token` (optional — fallback: secret `NOTION_TOKEN`; 입력은 디버깅용 권장)
  - `mdx_dest_path` (default: `posts/`)
  - `commit_mode` (default: `branch`) — `main` 또는 `branch`
  - `branch_name` (optional)
- Repo Secrets (필수/권장)
  - `NOTION_TOKEN` — Notion integration 토큰
  - `NOTION_DB_ID` — (선택) DB id, 또는 입력으로 제공 가능
  - `GITHUB_TOKEN` — Actions 기본 토큰(또는 PAT)으로 repo 쓰기 권한 필요
  - `(옵션) CDN_*` — 이미지 업로드 사용 시
- 우선순위: 환경변수/Secrets(`NOTION_TOKEN`) > workflow input(`notion_token`)

---

## 7. 변환 규칙 (Notion → MDX)
- Frontmatter 필드: `title`, `slug`, `date`(Publish Date 또는 created_time), `tags`(array), `excerpt`, `author`, `notion_id`, `last_edited_time`
- Body: `notion-to-md` 사용 권장 → 필요 시 후처리(이미지 링크, 코드블록 언어 태그 정리 등)
- Slug 결정: Notion DB `Slug` 속성 우선, 없으면 `slugify(title)` 사용
- Slug 중복 방지: 파일시스템(`mdx_dest_path`) 및 `state.pages[].slug`를 조회하여 충돌 시 접미사 `-2`, `-3` 형태로 고유화
- 파일명: `<slug>.mdx`

---

## 8. 커밋/푸시 정책
- `commit_mode = main`: main에 직접 커밋 및 푸시(개인/소규모 레포)
- `commit_mode = branch`: `notion-sync/<timestamp>`(또는 입력 `branch_name`) 브랜치 생성 → 커밋 → push → PR 생성(팀 환경)
- 커밋 메시지: `chore(notion): sync N post(s) [skip ci]`
- Git author: `notion-sync-bot <notion-sync-bot@example.com>` (환경변수로 오버라이드 가능)
- PR 생성: `peter-evans/create-pull-request` 또는 GitHub REST API 사용(선택)

---

## 9. 에러·재시도·중복 대책
- Notion API 호출: `p-limit`(concurrency=3) + `p-retry`(retries=3, 지수 백오프)
- 동시 실행 방지: 워크플로 `concurrency` 설정 사용(`group: notion-poll-sync`, `cancel-in-progress: true`)
- Idempotency: `content_hash` 비교로 중복 커밋 방지
- 실패 보고: 실패 시 Actions 로그, (옵션) Slack/Email 알림
- Fallback: 주기적 full reconciliation(전체 DB 스캔) 잡 권장(예: 1일 1회)

---

## 10. 테스트 전략 (act 기반)
- 준비: `act` 설치, 로컬에서 `npm ci`
- Secrets 전달: `-s NOTION_TOKEN=xxx -s NOTION_DB_ID=yyy -s GITHUB_TOKEN=zzz`
- 실행 예시
  - 단독 스크립트(권장 디버깅):
    ```bash
    NOTION_TOKEN=xxx NOTION_DB_ID=yyy MDX_DEST_PATH=posts/ POLL_INTERVAL_MINUTES=15 \
      node scripts/check-and-sync.js
    ```
  - `act`로 워크플로 시뮬:
    ```bash
    act -P ubuntu-latest=nektos/act-environments-ubuntu:18.04 \
      -s NOTION_TOKEN=xxx \
      -s NOTION_DB_ID=yyy \
      -s GITHUB_TOKEN=zzz \
      workflow_dispatch
    ```
- Test Cases
  1. 초기 실행 → 모든 포스트 생성 & state.json 작성
  2. 단일 포스트 수정 → 해당 파일만 변경 & 커밋
  3. 동일 내용 재실행 → 커밋 없음
  4. 입력 override(`mdx_dest_path`, `poll_interval_minutes`) 확인
  5. 실패 시(예: invalid token) 적절한 종료 코드와 오류 로그 출력

---

## 11. 모니터링 / 가시성
- 기본: Actions 로그로 상태 확인
- 선택: Slack 알림(성공/실패), Sentry(런타임 에러) 연동
- 디버깅: `upload-artifact`로 `state.json`/샘플 MDX 업로드 옵션 제공

---

## 12. 보안 고려사항
- 민감 토큰을 inputs로 전달하지 않도록 문서화(디버깅 용도 외 비권장). 기본은 repo Secrets 사용
- 호출 권한 최소화(워크플로 디스패치 시 호출자 토큰 최소 권한)
- 로그에 토큰 노출 금지, Notion signed URL 등 민감 링크 저장 주의(가능 시 이미지 재호스팅 정책 마련)
- 서드파티 Action은 태그 또는 SHA로 pin 권장

---

## 13. 운영/롤아웃 플랜
1) PoC: 로컬에서 `check-and-sync.js`로 실제 Notion 테스트 DB 연동(개발자 토큰)
2) Staging: Actions 워크플로를 별도 브랜치에서 `workflow_dispatch`로 검증
3) 초기 sync: 제한된 subset(예: 5개 포스트)으로 동작·커밋 검증
4) 운영 전 full sync(오프피크) 후 main 반영
5) 모니터링 및 주기적 reconciliation 스케줄 추가

---

## 14. 작업 항목 (Task List)
- [ ] `scripts/check-and-sync.js` 구현 (state 관리, Notion fetch, MDX 변환, hash 비교, git 커밋/푸시)
- [ ] `package.json` 및 deps 설정
- [ ] `.github/workflows/notion-poll-sync.yml` 작성 (schedule + workflow_dispatch, inputs 매핑, concurrency)
- [ ] 초기 `.notion-sync/state.json` 추가(빈 구조)
- [ ] `README_NOTION_SYNC.md` 작성(Secrets 설정, act 테스트, 운영 가이드)
- [ ] (옵션) 이미지 처리 정책 문서화/구현
- [ ] (옵션) PR 자동 생성 기능(브랜치 모드) 구현
- [ ] 테스트 시나리오 실행 및 Acceptance Criteria 검증 로그 캡처/정리

---

## 15. 의존성 및 비기능 요구사항(NFR)
- 런타임: Node.js 18 이상 권장
- 외부 API: Notion API Rate Limit 고려(동시성 3, 재시도 구성)
- 성능: 단일 실행에서 수백 건 페이지 처리 시 5~10분 내 완료 목표(네트워크 상황에 따라 가변)
- 신뢰성: 실패 시 재시도, 다음 실행에서 일관된 상태 회복(idempotent)
- 유지보수성: 코드 주석/로그 최소화·명확화, 설정값은 입력/환경변수로 분리

---

## 16. 상세 설계(요약)
- State 계산
  - `since`: `state.last_run`이 있으면 그 시각 이후, 없으면 과거(또는 `poll_interval_minutes`로 역산)
  - 매 실행 후 `last_run = now(UTC)`로 갱신
- Notion 쿼리
  - Database Query: `filter: last_edited_time > since`, pagination 처리
  - 각 페이지: `pages.retrieve` + `blocks.children.list`(pagination)로 전체 본문 취득
- 변환
  - `notion-to-md`로 Markdown 변환 → 필요 시 MDX 친화 후처리(이미지/코드블록)
  - Frontmatter 구성 후 본문 결합
  - `content_hash = sha256(frontmatter + body)`
- Slug & 파일 쓰기
  - slug 결정 및 중복 방지 후 `<slug>.mdx`로 저장(존재 비교)
- Git
  - 변경 파일이 없으면 종료
  - 변경 있으면 add/commit
  - `commit_mode = main` → push; `branch` → 브랜치 생성·push·PR 생성(옵션 액션)

---

## 17. 예시 워크플로 스케치(요약)
```yaml
name: Notion Poll Sync

on:
  schedule:
    - cron: '*/10 * * * *' # 10분 주기
  workflow_dispatch:
    inputs:
      poll_interval_minutes:
        description: 'Polling interval in minutes'
        type: number
        default: 15
      notion_db_id:
        description: 'Override Notion DB ID'
        type: string
      notion_token:
        description: 'Override Notion token (debug only)'
        type: string
      mdx_dest_path:
        description: 'Destination for MDX files'
        type: string
        default: 'posts/'
      commit_mode:
        description: 'Commit to main or branch'
        type: choice
        options: [branch, main]
        default: branch
      branch_name:
        description: 'Branch name when commit_mode=branch'
        type: string

concurrency:
  group: notion-poll-sync
  cancel-in-progress: true

jobs:
  sync:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install deps
        run: npm ci

      - name: Run sync
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_DB_ID: ${{ secrets.NOTION_DB_ID }}
          INPUT_NOTION_DB_ID: ${{ inputs.notion_db_id }}
          INPUT_NOTION_TOKEN: ${{ inputs.notion_token }}
          MDX_DEST_PATH: ${{ inputs.mdx_dest_path }}
          POLL_INTERVAL_MINUTES: ${{ inputs.poll_interval_minutes }}
          COMMIT_MODE: ${{ inputs.commit_mode }}
          BRANCH_NAME: ${{ inputs.branch_name }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/check-and-sync.js

      - name: Upload artifacts (debug)
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: notion-sync-debug
          path: |
            .notion-sync/state.json
            posts/**/*.mdx

      # (선택) branch 모드에서 자동 PR 생성 시 peter-evans/create-pull-request 사용
```

---

## 18. 리스크 & 완화
- Notion Rate Limit 초과 → `p-limit` / `p-retry`로 제어, 지수 백오프
- Slug 충돌 → 파일/상태 기반 ensure-unique 로직 적용
- 시간대/시계 틀어짐 → UTC 고정, `last_run` 저장/사용, Notion `last_edited_time` 신뢰
- 대량 변경 시 장시간 실행 → 페이지네이션/배치 처리, 1회 실행 시간 상한 모니터링
- 이미지 만료 URL 영속화 문제 → 재호스팅 정책(옵션) 또는 on-demand 변환 시 치환

---

## 19. 오픈 이슈 / 결정 필요 사항
- PR 생성 방식: 서드파티 액션 사용 vs 직접 API 호출
- 이미지 처리 전략: 즉시 재호스팅 vs 추후 일괄 마이그레이션
- 태그/작성자 등 메타데이터 매핑 규칙 상세(팀 컨벤션 확정 필요)

---

## 20. 로드맵(차기)
- 이미지 업로드(Cloudflare R2/S3 등) 파이프라인 연동
- 웹훅 기반 부분 동기화(보조 채널) 병행
- 멀티 DB/멀티 컬렉션 지원
- 변환 규칙 커스터마이저블 플러그인 구조

---

## 21. 레포지토리 가이드라인 준수
- YAML: 2-space indent, kebab-case 키, 파일명 kebab-case
- Bash: `#!/usr/bin/env bash`, `set -euo pipefail`, 긴 옵션 선호, 변수 인용
- Env vars: UPPER_SNAKE_CASE; inputs/outputs: kebab-case
- Composite actions: `composite/<name>/action.yml`; 스크립트는 `scripts/`에 배치, 실행 권한

---

## 22. 부록 — 스크립트 의사코드 스케치
```text
load env + inputs
resolve config (db_id, token, paths, commit_mode, branch)
load state.json (or init)
compute since = last_run or now - poll_interval
query Notion DB for pages where last_edited_time > since (paginate)
for each page:
  retrieve page + blocks (paginate)
  md = notion-to-md(page, blocks)
  frontmatter = {...}
  body = postprocess(md)
  content = fm + body
  hash = sha256(content)
  if new or hash changed:
    slug = ensureUniqueSlug(title/prop)
    write file <slug>.mdx
    update state.pages[id] = { slug, last_edited_time, content_hash }
changes = count(written files)
update state.last_run = now
persist state.json
if changes > 0:
  git add/commit ("chore(notion): sync N post(s) [skip ci]")
  if commit_mode = main: push
  else: create/checkout branch -> push -> (optional) create PR
exit 0
```

---

본 PRD는 구현·테스트·운영 전 과정의 기준 문서로 사용하며, 세부 구현 시점의 피드백을 반영해 현행화한다.

