# KICK-X 디자인·기능 인계: 경기별 가격, 본진·서브팀, 투표

기준은 클로드의 `9f3ea17`과 `CLAUDE_DESIGN_RESULT_2026-11-06.md`다. 그때 반영한 스쿼드 선택 카드, 매각 버튼 유지, 거래 모달 정원 안내, 고정 선수 대상 카드와 첨부 취소 디자인을 보존하고 이번 정책을 추가했다.

## 1. 이번에 바뀐 정책

### 경기력과 가격

기존에는 출전에 1~2점을 주고 공격·수비 기록을 더했다. 수집된 출전 기록 14,075건 중 9,985건(약 71%)이 5점 이하였다. 가격은 이전 시즌 기준과 이번 시즌 누적 점수로 만든 목표가격을 뒤따랐다. 그래서 새 경기 점수가 낮아도 아직 목표가격 아래면 올랐고, 높은 점수를 받아도 반대 상황에서는 떨어졌다. 수정 전 실제 가격 기록에서 1점 이하 상승 143건, 8점 이상 하락 61건을 확인했다.

이제 확인된 출전은 중립 6점에서 시작한다. 출전 시간이 짧다는 이유만으로 나쁜 경기로 평가하지 않는다. 확인한 가감점만 반영하고 총점은 0~10점이다. API에서 제공하지 않은 통계를 0으로 만들어 채우지 않는다.

| 항목 | GK | DF | MF | FW |
| --- | --- | --- | --- | --- |
| 출전 기본 평가 | 6 | 6 | 6 | 6 |
| 득점당 | +4 | +3 | +2.5 | +2 |
| 도움당 | +2 | +1.5 | +1.5 | +1.5 |
| 유효 슈팅당 | — | — | +0.2 | +0.25 |
| 키패스당 | — | +0.15 | +0.25 | +0.15 |
| 성공 크로스당 | — | +0.1 | +0.1 | +0.1 |
| 패스 1회 이상, 성공률 85% 이상 | — | +0.3 | +0.3 | — |
| 실제 출전 중 무실점, 60분 이상, 퇴장 제외 | +1 | +1 | +0.3 | — |
| 태클 성공+가로채기 | — | 3회당 +0.3 | 회당 +0.15 | — |
| 실제 출전 중 2실점당 | −0.5 | −0.5 | — | — |
| 3선방당 / PK 선방당 | +0.5 / +3 | — | — | — |
| 경고 / 퇴장 / 자책골 | −0.7 / −2.5 / −1.5 | 동일 | 동일 | 동일 |

가격 변동률은 `(점수 − 6) × 2.5% × min(출전 분 / 60, 1)`이며 경기당 ±10%로 제한한다. 60분 이상이면 6점 유지, 8점 +5%, 4점 −5%, 10점 +10%다. 30분 출전 8점은 +2.5%다. 확인된 미출전은 기존처럼 −1.5%이며 점수는 없다. 직전 가격에 변동률을 적용하고 정수 포인트 반올림·전체 가격 범위를 적용한다.

시즌 누적 목표가격은 가격 방향을 결정하는 데 사용하지 않는다. 초기 가격은 이미 확정한 이전 시즌 포지션별 기준과 5만~15만P 범위를 유지한다. 전체 가격 범위 1만~100만P도 유지한다. 기존 경기를 재산정하되 지갑 잔액, 체결 거래와 보유 원가는 보존한다. 서비스 시작 기준은 10월 15일 00:00 KST다.

미출전으로 하락했을 때 이전 경기의 높은 점수가 이번 하락의 점수처럼 보이지 않도록 시장 스냅샷도 보정했다. 가격에 영향을 준 경기와 점수의 연결을 임의로 바꾸지 말 것.

### 리포트

리포트 상단에 서버 수치로 만든 가격 반영 근거를 항상 표시한다. AI를 사용할 수 없는 경우에도 점수·전후 가격·변동 기준은 표시된다. AI는 기준점 대비 평가와 실제 가격 방향을 먼저 설명하고, 하락을 긍정적인 말로만 포장하지 않는다. 출전 기본 평가를 실제 활약으로 과장하지 않는다.

경기 점수뿐 아니라 가격 결과가 정정되어도 해당 설명 캐시를 무효화한다. 같은 경기의 캐시 행을 재사용하며 클릭할 때마다 새 행을 만들지 않는다. 과거 리포트를 일괄 생성하지 않는다. 기존 로그인 제한, 생성 잠금·시간 제한·일일 한도·캐시 용량 제한을 유지했다. 화면에 산정 정책의 내부 버전명을 추가하지 말 것.

## 2. 본진·서브팀

본진을 포함해 리그별 1개씩 최대 5개 팀이다. 본진은 1개, 서브팀은 다른 리그에서 최대 4개다.

| 대상 | 글 작성 | 댓글 | 투표 | 읽기 |
| --- | --- | --- | --- | --- |
| 본진 구단 | 가능 | 가능 | 가능 | 가능 |
| 서브팀 | 불가 | 가능 | 가능 | 가능 |
| 다른 구단 | 불가 | 불가 | 불가 | 가능 |
| 모든 선수 게시판 | 가능 | 가능 | 가능 | 가능 |

로그인·프로필·이용 제한 검사도 적용한다. 다른 구단의 부적절한 글 신고와 본인 글 삭제 기능은 유지한다.

- 회원가입 후 프로필 등록에서 본진을 반드시 선택한다. 저장할 때 영구 변경·해제 불가와 공식 엠블럼 고정 안내를 확인창으로 보여준다.
- 기존 회원의 첫 번째 응원 구단을 임의로 본진으로 확정하지 않는다. 마이페이지에서 직접 확인해야 한다. 기존 회원이 아직 본진을 정하지 않았어도 닉네임·프로필 아이콘은 저장할 수 있다.
- 본진은 저장 후 변경·해제할 수 없다. 프로필 아이콘을 바꿔도 닉네임 앞의 본진 공식 엠블럼은 유지된다. 게시글·댓글·게시판 목록·작성자 활동·랭킹·내 프로필·헤더에 연결했다.
- 서브팀은 가입 후 1시간 동안 변경할 수 있다. 이후 매년 **2월 1~7일, 9월 1~7일, 한국 시간**에 리그별 한 번씩 변경할 수 있다. 팀 해제도 변경에 포함한다.
- 본진과 서브팀 변경 제한은 API와 DB에서도 강제한다. 클라이언트에서 날짜·대상을 바꿔 요청해도 우회할 수 없다.

디자인 보완 시 잠금 안내, 본진/서브팀 구분, 다음 변경 기간과 저장되지 않은 선택 상태를 명확히 보여주면 된다. 원래 프로필 아이콘과 영구 본진 엠블럼은 서로 다른 요소다.

## 3. 투표와 보유 인증

구단·선수 게시글의 전체 작성 화면과 빠른 작성 화면에 선택형 투표를 넣었다. 질문 2~120자, 서로 다른 선택지 2~6개, 선택지당 1~80자, 기간 1·3·7·14일이다. 한 사람당 한 표이며 마감 전 표를 바꿀 수 있다. 게시 후 질문·선택지는 바꾸지 않는다. 마감 후 결과만 본다. 개인별 투표자 명단은 공개하지 않는다.

선수 게시글·댓글의 보유 인증은 DB의 현재 보유 여부로 표시한다. 보유 수량·원가·잔액은 노출하지 않는다. 매각하면 다음 조회에서 인증이 사라진다. 보유하지 않은 선수의 글도 작성할 수 있다. 기존의 대상 선수 고정·제목 필수·같은 선수 거래 첨부·첨부 취소·작성 화면 재진입 초기화는 유지한다.

투표 카드는 선택 상태, 투표한 항목, 득표수·비율, 마감과 참여 권한을 구분한다. 새 투표 테이블은 게시글/회원당 1행이며 중복 클릭으로 행이 늘어나지 않는다.

## 4. 차트·일정

- 선수 차트는 `1개월 / 3개월 / 전체`로 변경했다. 전체 이력도 서버에서 가져오며, 장기 운영 시 최대 약 800점으로 제한해 응답이 커지지 않도록 했다. 기간 버튼은 이미 받은 데이터를 사용하며 추가 요청을 만들지 않는다. 서비스 시작 이전 가격 이력을 새로 만들지는 않는다.
- 경기 일정은 `날짜 → 리그 → 시작 시간` 순서다. 날짜 접기/펼치기, 모두 접기/펼치기, 최근 일주일 기본 펼침, 연·월 선택, 오늘 위치와 최신 버튼을 유지한다. 전체 일정은 5대 정규 리그, 구단 상세는 수집한 다른 대회 일정도 유지한다.

## 5. 유지할 경계

4-3-3, GK 1/DF 4/MF 3/FW 3의 정원, 중복 보유 금지, 매입·매각 시 자동 경기장 반영, 초기 자금·수수료, 거래 제한 시간, 기존 인증과 알림 기능은 유지한다. DB 재산정은 원천 API 재수집이나 AI 생성 없이 저장된 검증 기록을 사용한다. 일괄 처리와 경기별 종료 시각 재사용으로 무료 DB의 반복 계산을 줄였다.

디자인 작업에서 서버 점수·가격 계산, 날짜 제한, 권한 검사, 투표 집계, 거래 정원·결제 코드를 제거하거나 클라이언트 계산으로 대체하지 말 것. 디자인 검증에는 `tests/primary-polls-browser.mjs`의 320·390·768·1440px 사례와 기존 스쿼드/프로필/커뮤니티 회귀 검사를 사용한다.

실제 재산정·무결성·권한·사용량 검증 결과는 `docs/evidence/neutral-pricing-primary-polls-2026-11-06.json`에 기록한다.

## 6. 운영 검증 결과

- 현재 정책의 경기력 14,034건, 거래 대상 선수 2,934명의 경기별 가격 8,218건을 재산정했다. 시장에서 제외된 과거 선수 77명도 같은 기준으로 정리해 전체 가격 기록은 8,312건이다.
- 점수·가격 방향 불일치, 점수·가격 리포트 해시 불일치, 가격 범위·변동 한도 위반, 점수와 항목 합계 불일치는 모두 0건이다. 실제 최대 상승률 +10%를 확인했다.
- 지갑·체결 거래·보유 원가 전체 해시가 작업 전후 동일하다. 원천 API 재호출과 AI 일괄 생성은 0회다.
- 재산정 전 백업 81,380개 레코드는 내용 해시를 유지해 163개 묶음과 메타데이터로 압축했다. 보관 데이터는 약 43.5MB에서 11.7MB로 줄었으며, 운영 조회가 접근하지 않는 비공개 테이블에만 보관한다. 전체 DB는 작업 후 약 356MB다.
- 단위 테스트 274개, SQL 검증 스크립트 33개, 빌드·타입 검사·린트가 통과했다. 브라우저 기본 점검 52개 경로·29개 항목과 UI 회귀 9개 항목, 기존 커뮤니티·알림·프로필·스쿼드 검사 및 새 본진·투표·일정·차트 검사를 통과했다.
- 새 공개 RPC는 본인 프로필 저장만 허용한다. 일반 회원의 본진/서브팀 직접 수정, 투표 원본 조회, 비회원 프로필 저장 권한은 없다. 기존의 필수 원천 기록 누락에 대한 산정 보류는 임의 해제하지 않았다.

수동 점수 복구 스크립트도 계산 엔진의 정책 상수를 가져오도록 맞춰, 이후 복구 작업이 이전 산정 식별자로 거절되지 않게 했다.

## 7. 변경 파일

- `.github/workflows/check.yml`
- `.gitignore`
- `app/api/kickx/community/route.ts`
- `app/api/kickx/profile/route.ts`
- `app/globals.css`
- `components/kickx/auth.tsx`
- `components/kickx/avatar.tsx`
- `components/kickx/community-activity.tsx`
- `components/kickx/community-detail.tsx`
- `components/kickx/community-feed.tsx`
- `components/kickx/community-poll.tsx`
- `components/kickx/community.tsx`
- `components/kickx/fixtures.tsx`
- `components/kickx/match-report.tsx`
- `components/kickx/players.tsx`
- `components/kickx/ranking.tsx`
- `components/kickx/rules-report.tsx`
- `components/kickx/shell.tsx`
- `docs/CLAUDE_HANDOFF_PRICING_PRIMARY_POLLS_2026-11-06.md`
- `docs/evidence/neutral-pricing-primary-polls-2026-11-06.json`
- `lib/kickx/community-activity.ts`
- `lib/kickx/fixtures.ts`
- `lib/kickx/match-report.ts`
- `lib/kickx/score-labels.ts`
- `lib/kickx/support.ts`
- `lib/kickx/types.ts`
- `lib/kickx/validation.ts`
- `server/kickx/catalog-pages.ts`
- `server/kickx/engine/report-performance.ts`
- `server/kickx/engine/report-policy.ts`
- `server/kickx/engine/report-pricing.ts`
- `server/kickx/engine/service.ts`
- `server/kickx/mock-data.ts`
- `server/kickx/prototype.ts`
- `server/kickx/public-prototype.ts`
- `server/kickx/report-model.ts`
- `server/kickx/supabase-repository.ts`
- `supabase/migrations/20261106014545_neutral_score_primary_clubs_and_polls.sql`
- `supabase/migrations/20261106015451_bulk_neutral_assessment_replay.sql`
- `supabase/migrations/20261106020058_materialized_neutral_replay_clocks.sql`
- `supabase/migrations/20261106021012_bounded_neutral_replay_checkpoint.sql`
- `supabase/migrations/20261106022237_compact_valuation_checkpoint_batches.sql`
- `supabase/migrations/20261106022555_preserve_legacy_profile_support.sql`
- `tests/browser-smoke.mjs`
- `tests/catalog-pages.test.mjs`
- `tests/database-bootstrap.sql`
- `tests/database-community-activity.sql`
- `tests/database-community.sql`
- `tests/database-match-reports.sql`
- `tests/database-neutral-assessments.sql`
- `tests/database-primary-polls.sql`
- `tests/database-profile-avatar.sql`
- `tests/database-supported-clubs.sql`
- `tests/match-reports.test.mjs`
- `tests/neutral-policy.test.mjs`
- `tests/primary-polls-browser.mjs`
- `tests/profile-clubs.test.mjs`
- `tests/read-performance.test.mjs`
- `tests/report-policy.test.mjs`
- `tests/squad-market-community-browser.mjs`
- `scripts/prepare-score-repairs.mjs`
