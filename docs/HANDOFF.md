# 2026-10-26 정책 변경 우선 확인

[보고서 기준 정책 적용](REPORT_POLICY_2026-10-26.md)을 먼저 읽는다. 보유 정원은 제거하고 4-3-3 선발 정원만 유지한다. 이전 시즌 기준 준비 후 report-v3로 전환하며, 이전 인계장의 전체 보유 GK1/DF4/MF3/FW3 매입 제한을 되살리지 않는다. 아래 과거 기록은 작성일의 상태다.

# 최신 Claude 인계 — 2026-10-21

현재 기능·디자인 계약과 2026-10-12 Claude 결과 이후 변경 사항은 [최신 누적 인계장](CLAUDE_HANDOFF_2026-10-21.md)을 먼저 확인한다. 스쿼드는 **4-3-3 고정**, 전체 보유 정원은 **GK 1 / DF 4 / MF 3 / FW 3**이며 견적과 체결에서 검사한다. 등번호·게시글 카테고리는 제거됐고 경기 AI 리포트와 로딩·DB/egress 개선이 적용됐다. 10/18 Claude의 최신 `polish.css` 스타일을 유지한다.

아래는 이전 시점의 작업 기록이다. 당시 SQL 실행 대기·5종 포메이션·AI 보류 같은 문구는 현재 상태를 설명하지 않는다.

# 최신 경제 로직: 2026-10-13

과거 경기 초기 가격·최근 5출전 가격과 새 배점은 [ECONOMY_FORM_V2_2026-10-13.md](ECONOMY_FORM_V2_2026-10-13.md)를 따른다. 운영 전환에는 `202610130001_performance_market_v2.sql` 전체 실행이 필요하다. 미실행 DB는 v1 엔진·규칙을 유지한다. 지갑·체결·보유 원가는 유지한다.

> 2026-10-12 추가: [정책·구현 검토](REVIEW_2026-10-12.md), [한글화 적용](LOCALIZATION_2026-10-12.md), [Claude 디자인 인계](CLAUDE_DESIGN_HANDOFF_2026-10-12.md), [Claude 디자인 결과·남은 백엔드 의존성](CLAUDE_DESIGN_RESULT_2026-10-12.md)를 먼저 확인하세요. 새 점수·가격은 아직 제안 단계입니다.

# KICK-X 인수인계 — 2026-10-09

**최신 지시: 관리자 업무는 회원·거래·커뮤니티 관리이며 축구 데이터·Performance·가치·랭킹·한글명은 자동 처리한다.** [자동 운영 설정](AUTOMATION_2026-10-09.md)을 먼저 읽는다.

Claude 프론트 main `0be4f0c`의 Yellow Playbook을 유지하면서, 사용자 요청에 따라 게임 기능 프로토타입을 추가했다. 자세한 정책·결측·정정·활성화 절차는 [프로토타입 작업 기록](PROTOTYPE_2026-10-09.md), 앞으로 할 일은 [다음 작업](next-steps.md)을 먼저 읽는다.

## 반드시 유지할 지시

- Next.js 16 App Router(cacheComponents), React 19, TypeScript, Supabase RLS/Google OAuth, Vercel 유지.
- Yellow Playbook: 노랑 `#ffe23a`·검정 `#111110`·흰색, 상단 가로 메뉴. 다크 블루/좌측 사이드바 지시는 폐기된 과거 정보다.
- 이번에는 데이터·API·연결 틀을 준비했다. **다음 담당 Claude가 프론트 디자인을 이어서 작업**한다. 프론트에서 실제 가격·Performance·수수료·정산 정책을 새로 계산하지 않는다.
- 사용자 요청으로 최초 1,300,000P, 기본 가치 100,000P, 매각 2%를 **시범 정책**으로 구현했다. 최종 확정 정책과 혼동하지 않는다. Performance는 0~100이 아닌 원점수다.
- 동일 선수는 회원당 1명. 시스템 상대 매입/매각. 거래 수요로 가치 변동시키지 않는다.
- 미확정 값은 `—`, null ≠ 0. 예시 모드는 반드시 `예시 데이터` 배지, 실제 저장 증거로 쓰지 않는다.
- **AI 생성·실제 축구 선수 이적 처리만 보류**. 기존 Cron 금지는 사용자 정정으로 폐기했다. BSD/FotMob 세부 차이는 사용자 요청상 추후 보정한다.
- 이미 적용된 SQL 재실행, 운영 DB 시드, `npm audit fix --force` 금지.
- `BSD_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 서버/Actions Secret에만. 관리자 방문은 자동 작업과 무관하다. 기존 수집 상태 확인 CLI는 `--status`만.
- 코드 변경 보고는 한국어 `[이번 작업 내용] [변경 파일] [현재 동작] [검증] [다음 작업]` 순서. 코드를 보여줄 때 전체/일부 명시.

## 구현 현황

| 분야 | 준비된 동작 | 운영 확인 |
| --- | --- | --- |
| Performance·가치 | 점수표, 출전 구간/카드/자책골/무실점, 잠정 산정/보류, 원본 경합 검사, 정정 전체 재계산·이력 | 자동 큐로 계산; 실제 원본 품질 대조는 추후 |
| 지갑·거래·자산 | 1회 최초 지급, 60초 견적, 원자적 정산, 중복 요청·보유 방지, 자산·손익·거래 페이지 | 새 SQL 적용 후 실제 로그인 매입/매각 확인 |
| 스쿼드 | 서버 저장, 5종 포메이션, 보유/중복/포지션/revision 검증, 매각 시 자리 비우기 | 실제 저장·재로그인 점검 |
| 랭킹 | KST 주/월 기준 자산과 수익률 스냅샷, 동률·기간 중 가입 처리, 자산 변경·정기 자동 갱신 | 새 004→005 SQL과 Actions 설정 필요 |
| 커뮤니티 | 글/댓글/답글 수정·삭제, 거래 첨부, 공감, 조회, 신고, 검색·페이지, 팬·작성자 권한 | 두 계정으로 운영 확인 |
| 관리자 | 회원 검색·기간제 이용 제한/해제, 거래 조회, 신고 숨김/복원/기각, 감사 | 관리자 역할·서버 키 유지 |
| 탐색·팀 | 등번호 기본 정렬, 일정 → `/teams/[teamId]`, 한글/별칭 검색 구조 | Wikidata 생년월일·이름 일치 자동 매핑; 미확인 원문 유지 |
| AI·이적 | 새 기능 추가 없음 | 사용자 후속 지시까지 대기 |

이 변경 작업에서 운영 DB를 직접 변경하지 않았다. 코드 검증과 운영 서비스 활성화는 별개다. 사용자가 001→002→003 적용을 완료했다. 이번에는 **`202610090004_automated_operations.sql`→`202610090005_automatic_reliability.sql`**를 순서대로 한 번 적용한다. 004를 이미 적용했다면 005만 실행한다. 이전 SQL은 재실행하지 않는다.

## Claude용 연결 지도

| 화면/기능 | 조회·변경 계약 | 주요 파일 |
| --- | --- | --- |
| 공통 상태 | `/api/kickx`, `DataResponse<PlatformData>` | `components/kickx/provider.tsx`, `server/kickx/{service,supabase-repository,catalog,public-prototype}.ts` |
| 전체 선수/관심/보유 | `GET /api/kickx/players`, scope=all/watch/owned, sort=number 등 | `catalog.tsx`, `server/kickx/catalog-pages.ts`, `lib/kickx/catalog-query.ts` |
| 선수 상세 | `GET /api/kickx/players/:id`, `scoreDetails` 추가 | `players.tsx`, `performance.tsx` |
| 팀 정보 | `/teams/:teamId`, 선수·경기 API의 team 필터 | `team.tsx`, `fixtures.tsx` |
| 정책·프로토타입 예시 | `/rules` | `app/rules/page.tsx`, `server/kickx/engine/performance.ts` |
| 거래 견적 | `POST /api/kickx/trades/quote {playerId,side}` | `lib/kickx/trade.ts`, `ui.tsx` TradeDialog |
| 거래 확정 | `POST /api/kickx/trades {quoteId,requestId}` | 견적·금액 서버 산출, 재시도 시 requestId 유지 |
| 거래 전체 조회 | `GET /api/kickx/trades?page=&q=&side=&days=` | `assets.tsx`, 50개씩, 응답 DataResponse |
| 스쿼드 저장 | `PUT /api/kickx/squad {formationId,slots,revision}` | `squad.tsx`; slots는 null 포함 11개 |
| 커뮤니티 목록 | `GET /api/kickx/community?scope=&target=&q=&category=&sort=new/popular&page=` | `community.tsx`, 목록 20개씩 |
| 글 상세 | 동일 API `?postId=UUID&page=` → `{post,comments}` | `community-detail.tsx`, 댓글 50개씩 |
| 커뮤니티 쓰기 | `POST /api/kickx/community`, action별 입력 | 아래 표 및 SQL `kickx_community_write` |
| 관리자 조회 | `GET /api/kickx/admin` | `ingestion.ts`, `admin.tsx` |
| 신고 처리 | `POST /api/kickx/admin/prototype`, action=moderate만 | `admin.tsx`; 계산 action은 거부 |
| 회원 관리 | `GET/POST /api/kickx/admin/users`; 30개씩; days=0/1/7/30 | `members-admin.tsx`; 닉네임/ID 검색, 사유 필수 |
| 자동 운영 | GitHub Actions → service-role RPC | `scripts/automatic-football.ts`, `scripts/lib/{automatic-football,player-names}.mjs` |

공개 player 배열은 전체가 아니라 미리보기다. 전체 수는 `playerTotal`, 보유 전용 선수 정보는 `member.ownedPlayers`; `getPlayer()`는 보유 목록과 조회 캐시를 이용한다. 전체 팀 96개 참조 사전은 유지한다. API 목록은 검색 250ms 디바운스·서버 필터·페이지를 유지한다.

| 커뮤니티 action | 핵심 입력 |
| --- | --- |
| createPost | requestId(UUID), scope, target, category, title, body, transaction(선택 없으면 빈 문자열) |
| editPost | postId, revision, 위 글 내용; 대상·scope 이동 불가 |
| deletePost | postId, revision |
| comment | postId, requestId(UUID), body, parentId(선택, 최상위 댓글만) |
| editComment / deleteComment | postId, commentId, revision, body(수정만) |
| like | postId, liked(boolean) |
| view | postId |
| report | postId, commentId(선택), reason |

관리자 action: `moderate`+reportId/operation(hide,dismiss,restore)/reason만 허용. 회원 관리 POST는 userId/days/reason. `/admin/data`는 `/admin`으로 이동한다. 수집 POST는 410으로 종료한다. 관리자 역할은 서버와 RPC에서 확인한다. 일반 회원은 브라우저에서 테이블 직접 변경할 수 없다.

## 프론트 인계 우선순위

1. 기존 Yellow Playbook 안에서 새 팀 정보·점수 내역·정책·관리자 입력 UI를 다듬는다. 전체 디자인 교체는 하지 않는다.
2. 견적 로딩·만료·가격 변경·잔액 부족·이미 보유·성공 상태, 스쿼드 revision 충돌, 커뮤니티 작성 권한·오류를 더 명료하게 표현한다.
3. 경기 점수의 잠정/보류와 데이터 경고 코드를 사용자용 문구로 정리한다. 현재 세부 warning 코드는 접힌 확인 영역에 있다.
4. 댓글 답글 배치, 삭제/숨김된 부모 안내, 게시글 상세 header, 모바일 여백·버튼·폼을 개선한다. API 데이터를 가짜 값으로 대체하지 않는다.
5. 새로운 회원 관리 화면을 같은 디자인으로 다듬는다. 수동 수집·선수 계산·가격/랭킹 활성화 버튼은 되살리지 않는다. 검수한 명단의 일괄 업로드, 전체 신고/거래 페이지네이션은 후속 개선 가능하다.
6. 경제 정책 변경은 프론트만 바꾸지 않는다. 서버/DB 규칙 버전과 문서를 함께 변경해야 한다.

### 2026-10-09 Claude 프론트 반영분

- 팀 정보 `/teams/[id]`: 구단색 배너, 등번호 선수 카드, 경기 카드(`fixtures.tsx`의 `MatchRow` 공용).
- 게시글 상세(`community-detail.tsx`): 대상 엠블럼 경로, 공감 토글(`aria-pressed`), 답글 들여쓰기, 부모가 없는 답글 안내, 권한별 작성 안내, 신고 사유 글자 수.
- Performance 산정 내역(`performance.tsx`): 경기별 상태·점수·근거표, 경고 코드는 `lib/kickx/score-labels.ts`에서 사용자 문구로 변환하고 원본 코드는 접어서 표시. 점수는 저장값만 표시하고 다시 계산하지 않는다.
- `/rules`: 정책 카드·점수표·계산 예시 재구성(예시 값은 기존처럼 실제 계산 함수 호출).
- Claude의 기존 관리자 게임 운영 카드는 이번 사용자 정정으로 제거했다. 자동 실행 상태는 관리자 필수 업무가 아니다.
- 거래 확인 창: 견적 남은 시간·만료 시 새 견적, 가격 변경·만료 오류에 새 견적 버튼. 스쿼드: revision 충돌 시 편집 내용을 유지한 채 "최신 스쿼드 불러오기" 안내.
- 예시 데이터의 Performance를 0~100 값에서 원점수로 바꾸고 경기별 예시 산정 내역을 추가했다(예시 배지 유지).

## 기존 디자인 자산·함정

- `lib/kickx/club-identity.ts`: 표시용 약칭·구단색·엠블럼 패턴, 리그 표식. 데이터 원본 변경 금지.
- `ui.tsx`: ClubCrest/TeamBadge, LeagueMark, PlayerPortrait. 구단 로고 URL은 미검증이며 실제 로드 시만 대체, 반복 실패 시 중지한다.
- `select.tsx`, `options.tsx`: 접근 가능한 공통 드롭다운과 구단/리그 옵션. 네이티브 select로 되돌리지 않는다.
- `player-card.tsx`: 가치 null이면 산정 전과 수집 경기 요약 표시.
- 스타일은 `app/globals.css` → `app/styles/{tokens,base,components,shell,pages}.css`.
- `.empty`는 상태 요소에만. `.table-scroll`은 position:relative. 그리드 열은 minmax(0,1fr). `.modal`은 text-align:left.
- LeagueMark 내부 span의 색을 부모의 광범위한 선택자로 덮어쓰지 않는다. 테스트 alert는 텍스트로 범위 지정한다.

## 검증과 운영 범위

- `npm run lint`
- `npm test`: 기존 회귀 + 계산·API 권한 테스트.
- `npm run test:db`: 독립 메모리 PostgreSQL(PGlite)에서 전체 9개 migration과 8개 SQL 검증; 운영 연결을 읽지 않는다.
- `npm run build`
- `KICKX_BROWSER_MODULE=<playwright가 설치된 상위 경로> node tests/browser-smoke.mjs`: 1440/390 화면, 기존 흐름과 새 거래/스쿼드/커뮤니티 API 계약.
- CI는 PostgreSQL 17에서도 migration과 SQL 검증을 실행한다.
- 브라우저 테스트는 실제 운영 계정 없이 API 대역을 사용한다. 운영 OAuth·PostgREST·실제 원본에 대한 활성화 검증은 [자동 운영 설정](AUTOMATION_2026-10-09.md)을 따른다.

일상 운영은 [자동 운영 설정](AUTOMATION_2026-10-09.md)을 따른다. [manual-refresh.md](manual-refresh.md)는 과거 전체 수집·개발자 복구 기록이며 관리자 버튼 안내는 폐기됐다. 원본 수집/정규화/공개 요약을 섞지 않고, 과거 경기 소속으로 현재 소속을 덮어쓰지 않는다.
