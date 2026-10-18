# KICK-X DB 테이블 점검

2026-10-19 KST 운영 DB와 현재 코드 기준으로 점검했다. **대부분은 사용 중이지만 57개 모두가 현재 반드시 필요한 최종 구조인 것은 아니다.** 구 API용 빈 테이블과 미구현 AI 기능의 예비 테이블이 남아 있다. 수집 방식이 늘면서 운영 상태 테이블이 여러 묶음으로 나뉘어, 추후 통합할 여지도 있다.

이번 작업은 구조 점검과 문서화다. 운영 데이터·테이블·함수는 변경하지 않았다.

## 조사 범위와 판정 기준

- Supabase `kick-x` 프로젝트의 실제 카탈로그·테이블 크기·외래키·현재 public 함수 74개·뷰 2개를 확인했다.
- 앱·스크립트·워크플로의 조회·쓰기 참조와 DB 함수 내부 참조를 함께 조사했다. 과거 마이그레이션에만 이름이 있는 경우를 현재 사용으로 세지 않았다.
- 빈 테이블이라는 이유만으로 미사용으로 판정하지 않았다. 예를 들어 신고·정지·댓글은 행이 없더라도 동작하는 기능이 있다. 테이블 접근 누적 통계에도 검사·관리자 조회가 포함되므로 단독 근거로 쓰지 않았다.
- 아래 전체 목록의 행 수는 `pg_stat_user_tables.n_live_tup` 추정값이다. `football_player_seasons`·`player_analyses`의 0행과 수동 수집 3개 테이블의 행 수는 별도 COUNT로도 확인했다. 크기는 인덱스·TOAST 포함 MB다.

## 전체 수량

| 분류 | 테이블 수 | 크기 합계 | 판단 |
| --- | ---: | ---: | --- |
| 서비스 데이터 | 31 | 50.05MB | 현재 기능에서 사용 |
| 수집·자동화·정정·이력 보조 | 21 | 124.19MB | 현재 작업에서 사용 |
| 수동 수집·복구 | 3 | 0.53MB | 선택적 복구 도구에 연결 |
| 구 API 방식 | 1 | 0.016MB | 우선 정리 후보 |
| 미구현 AI 예비 | 1 | 0.016MB | 리포트 구조에 맞춰 재설계 |
| 직접 만든 public 테이블 합계 | **57** | **174.81MB** | 사용 여부와 최종 통합 여부는 별개 |

Supabase·확장 관리 테이블은 별도로 44개다. `auth` 27, `storage` 8, `realtime` 3, `cron` 2, `net` 2, `supabase_migrations` 1, `vault` 1이다. 이들은 KICK-X 업무 테이블 수에 합쳐 설명할 대상이 아니다. 특히 로그인, 예약 실행, HTTP 큐, 자격 증명 관리와 마이그레이션이 이 구조에 의존한다. 일부 플랫폼 기능이 비활성이어도 직접 삭제 대상으로 판단하지 않는다.

`player_catalog`와 `fixture_catalog`는 조회용 **일반 뷰 2개**다. 선수·경기를 추가 복제해 저장한 테이블 2개로 세지 않는다.

## 우선 정리할 후보

| 대상 | 실제 상태와 사용 경로 | 판단과 정리 조건 |
| --- | --- | --- |
| `football_player_seasons` | 0행. 구 `apply_football_batch` 함수만 참조하고 현재 앱·스크립트는 이 구 함수를 호출하지 않음 | 가장 분명한 제거 후보. 구 함수·관련 회귀 검사를 함께 정리하는 별도 마이그레이션으로 처리해야 함 |
| `player_analyses` | 0행. 선수 상세에서 body를 조회하지만 생성·저장 경로 없음. 선수 ID가 기본키여서 선수당 문구 하나만 저장 가능 | 현재 완성된 AI 리포트 기능이라고 설명하면 안 됨. 요구한 선수·경기별 퍼포먼스/가격 설명에는 경기·계산 버전/입력 해시를 식별하는 구조가 필요. 조회 코드를 함께 바꾸기 전 테이블만 삭제하면 상세 조회가 실패할 수 있음 |
| `football_sync_jobs` | 6행, 모두 BSD 단건 수집 완료. 마지막 실행 2026-10-02. `scripts/sync-football.mjs`가 계속 읽고 씀 | 구 API 전용 미사용 테이블이 아님. 단건 CLI를 유지하면 보존하고, 수집 도구를 통합할 때 대체 |
| `football_bulk_runs`·`football_bulk_tasks` | 1회 대량 수집 완료, 하위 작업 517개 모두 완료. `bulk-cli.mjs`와 관리자 GET 상태 조회가 참조 | 현재 자동 갱신의 주 경로는 아니지만 복구 도구에 연결돼 있음. 복구 경로와 상태 조회를 대체한 뒤 정리 가능 |

위 5개를 모두 합쳐도 약 0.57MB다. 이 수치는 삭제 권고가 아니라 규모 비교다. 테이블 개수를 줄이는 작업만으로 현재 DB 용량 문제를 크게 해결할 수는 없다.

## 비슷해 보여도 역할이 다른 데이터

| 묶음 | 구분 이유 |
| --- | --- |
| `wallets`·`holdings`·`trades`·`wallet_ledger` | 현재 잔액, 현재 보유, 체결 사실, 포인트 변동 원장은 서로 다른 사실이다. 이력과 원장이 과거 자산·수익률 계산에도 쓰인다. |
| `player_market_snapshots`·`price_history`·`player_price_results` | 현재 확정 가격, 실제 발행 시간순 가격, 적용 경기별 재계산 근거를 구분한다. 경기 기록 정정 시 재계산 경로와 실제 발행 순서가 다를 수 있다. |
| `football_match_stats`·`performance_results`·`player_match_records` | 원본 통계, 계산 결과, 화면 전적용 가공 데이터다. 마지막 것은 파생 데이터이므로 향후 뷰 전환 후보가 될 수 있지만 현재 상세 페이지가 사용한다. |
| `player_season_summaries` | 수집한 경기만의 누적 통계를 미리 집계한다. 매번 전체 기록을 집계하는 조회 비용을 피하며, 실제 시즌 전체 통계라고 표시해서는 안 된다. |
| `players.name_ko`·`player_names` | 표시용 컬럼과 이름의 별칭·출처·수동 수정 이력을 구분한다. 현재 동기화 트리거와 이름 매핑 도구가 둘을 연결한다. |
| 정기 갱신·컵 수집·분 단위 갱신 상태 | 장시간 과거 수집이 분 단위 종료 경기 반영을 가로막지 않게 독립 상태로 처리한다. 다만 모든 작업 시스템을 지금처럼 별도 테이블군으로 유지해야만 하는 것은 아니다. |
| `automatic_fixture_checks`·`realtime_fixture_checks` | 과거 정정과 방금 끝난 경기의 점검 주기를 분리한다. 통합하려면 두 목적의 점검 시각·재시도 의미를 먼저 정의해야 한다. |

## 설계상 개선할 여지

1. 구 API 수집 경로를 정리해 `football_player_seasons`의 이유 없는 잔존을 없앤다.
2. AI 기능은 생성·저장·조회·재생성 조건까지 구현 범위를 정하고, 현재 예비 테이블을 경기별 구조로 대체하거나 확장한다.
3. 수집 작업을 공통 작업·하위 작업 모델로 통합하는 방안을 검토한다. 정기·컵·분 단위 작업의 독립 실행, 날짜 경계를 넘는 재개, 외부 요청 예산과 revision 비교는 유지해야 한다. 이름을 비슷하게 바꾸거나 테이블을 합치는 것만으로 해결되지 않는다.
4. 용량 최적화는 테이블 수보다 중복 원본·반복 계산 결과·완료 작업 payload의 보존 범위를 검토하는 편이 효과가 크다. 원본 통계와 경기별 원본에 겹치는 값이 있고 `calculation_revisions`는 변경마다 전체 계산 결과를 보존한다. 정정 가능성을 유지하는 보관 정책과 함께 검토해야 한다.
5. 파생 전적·시즌 요약을 뷰로 바꿀지는 실제 목록·상세 조회 성능과 업데이트 일관성을 측정한 뒤 판단한다. 테이블 수를 줄이려고 최근 해결한 느린 조회를 다시 만들면 안 된다.

## 첨부 명세서와의 관계

점검에 사용한 첨부 자료는 두 요구사항 DOCX다. 첫 번째 문서는 AI 가치 분석 리포트를 기능으로 명시한다. 두 번째 문서는 데이터 항목을 다음처럼 논리 단위로 정의한다. 두 파일의 내용을 임의로 합쳐 최신 확정 명세라고 간주하지 않았다.

| 첨부 두 번째 문서 항목 | 현재 구조의 대표 예 |
| --- | --- |
| DR-001 사용자 | profiles, user_roles, member_restrictions |
| DR-002 자산 | wallets, wallet_ledger, asset_snapshots |
| DR-003 리그 구단 선수 | leagues, teams, players, player_names |
| DR-004 경기 | fixtures |
| DR-005 선수 경기 기록 | football_match_stats, player_match_records, player_season_summaries |
| DR-006 Performance | performance_results, kickx_policy |
| DR-007 가치 이력 | player_market_snapshots, price_history, player_price_results, player_initial_values |
| DR-008 보유와 거래 | holdings, trades, trade_quotes, wallet_ledger |
| DR-009 선수단 | squads |
| DR-010 랭킹 스냅숏 | ranking_snapshots |
| DR-011 커뮤니티 | community_posts/comments/likes/views/reports/revisions |
| DR-012 처리 이력 | 수집·재시도·계산 큐, automation_runs, operation_audit 등 |

FR-DATA-05는 가치 변경 전후·적용 경기·계산 근거·규칙 버전·변경 시각 보존을, FR-DATA-06은 실패 항목 분리와 중복 없는 재처리를 요구한다. DR-013~016도 변경 이력·확정 거래값·규칙 버전·원본 식별자와 수집 시각을 요구한다. 따라서 이력과 재시도 구조 자체에는 명세 근거가 있다. **이 요구가 현재의 물리 테이블 수 57개를 유일하거나 최적인 설계로 확정하는 것은 아니다.**

명세서 작성은 다음 구조가 적절하다.

- 요구사항·논리 설계: 사용자, 축구 데이터, 경기력, 가치, 거래·자산, 선수단, 랭킹, 커뮤니티, 수집·처리 이력이라는 업무 단위로 설명한다.
- 물리 설계: 서비스 데이터 ERD와 수집·운영 ERD를 나누고 두 구조의 선수·경기·사용자 연결을 표시한다. 부록의 실제 테이블 정의서에는 public 57개 전체와 유지/정리 상태를 기록한다.
- Supabase 관리 영역: 인증·저장·스케줄러 등 외부 기반 서비스 의존성으로 설명한다. 관리 테이블 44개를 직접 설계한 업무 엔티티처럼 나열하지 않는다.
- 구현 현황: AI 예비 저장소와 구 API 구조를 현재 정상 제공하는 기능으로 표시하지 않는다.

## public 테이블 전체 목록

### 서비스 데이터 31개

| 테이블 | 역할 | 행 수 | 크기 | 현재 사용 근거 일부 |
| --- | --- | ---: | ---: | --- |
| `profiles` | 닉네임·응원 구단 등 서비스 프로필 | 1 | 0.049MB | `app/api/kickx/admin/users/route.ts:13` · `app/api/kickx/community/route.ts:28` · `kickx_auto_refresh_rankings()` · `kickx_can_write_lounge()` |
| `user_roles` | 관리자와 일반 회원 권한 | 0 | 0.016MB | `app/api/kickx/admin/users/route.ts:18` · `server/kickx/admin-db.ts:7` · `kickx_publish_calculation()` · `kickx_publish_calculation_v1()` |
| `member_restrictions` | 이용 정지 사유·기간과 관리자 조치 | 0 | 0.016MB | `server/kickx/ingestion.ts:26` · `kickx_profile_restriction()` · `kickx_require_active_member()` |
| `watchlists` | 사용자의 관심 선수 | 0 | 0.025MB | `app/api/kickx/watchlist/route.ts:12` · `app/api/kickx/watchlist/route.ts:18` · `kickx_member_data()` · `watched_player_catalog()` |
| `leagues` | 리그·컵 등 대회 식별자와 명칭 | 14 | 0.082MB | `apply_bsd_batch()` · `apply_football_batch()` |
| `teams` | 구단 소속 리그와 한글 이름 | 223 | 0.147MB | `app/api/kickx/profile/route.ts:9` · `scripts/lib/club-collection.mjs:10` · `apply_bsd_batch()` · `apply_football_batch()` |
| `players` | 선수 신원·소속·포지션과 표시 이름 | 5,137 | 2.556MB | `app/api/kickx/watchlist/route.ts:9` · `scripts/lib/player-names.mjs:51` · `apply_bsd_batch()` · `apply_football_batch()` |
| `fixtures` | 일정·상대·득점·종료 관측 시각 | 1,977 | 0.934MB | `server/kickx/catalog-pages.ts:64` · `apply_bsd_batch()` · `apply_football_batch()` |
| `kickx_policy` | 적용 중인 점수·가격·거래 정책과 기준 시점 | 1 | 0.033MB | `scripts/lib/club-collection.mjs:7` · `scripts/lib/realtime-football.mjs:118` · `kickx_auto_initialize_market()` · `kickx_auto_initialize_market_v1()` |
| `player_market_snapshots` | 현재 확정 가격·퍼포먼스와 반영 상태 | 3,209 | 1.008MB | `kickx_assets()` · `kickx_auto_initialize_market()` |
| `performance_results` | 선수·경기별 점수·세부 근거·보류 사유 | 17,856 | 27.337MB | `server/kickx/catalog-pages.ts:54` · `kickx_check_calculation()` · `kickx_fixture_reflection()` |
| `player_initial_values` | 선수별 초기 가치와 사용한 과거 경기 근거 | 3,100 | 2.220MB | `server/kickx/catalog-pages.ts:55` · `kickx_publish_calculation()` |
| `player_price_results` | 선수·경기별 가격 전후·목표가·최근 출전 계산 근거 | 973 | 0.844MB | `server/kickx/catalog-pages.ts:56` · `kickx_publish_calculation()` |
| `price_history` | 실제로 발행한 선수 가격의 시간 순서 이력 | 12,530 | 3.539MB | `server/kickx/catalog-pages.ts:51` · `kickx_assets_at()` · `kickx_auto_initialize_market_v1()` |
| `wallets` | 사용자의 현재 포인트와 최초 지급 기준 | 1 | 0.025MB | `kickx_assets()` · `kickx_auto_refresh_rankings()` |
| `wallet_ledger` | 최초 지급·매입·매각에 따른 포인트 원장 | 3 | 0.082MB | `kickx_assets_at()` · `kickx_open_wallet()` |
| `trades` | 체결 당시 가격·수수료·정산액·요청 식별자 | 2 | 0.098MB | `app/api/kickx/trades/route.ts:7` · `server/kickx/ingestion.ts:22` · `kickx_assets_at()` · `kickx_auto_initialize_market_v1()` |
| `trade_quotes` | 가격 확인 후 체결에 사용하는 한시적 견적 | 4 | 0.033MB | `kickx_quote_base()` · `kickx_trade()` |
| `holdings` | 현재 보유 선수와 매입 원가 | 2 | 0.033MB | `kickx_assets()` · `kickx_market_eligible()` |
| `squads` | 최대 11명의 포메이션·배치와 수정 버전 | 1 | 0.033MB | `kickx_member_data()` · `kickx_save_squad()` |
| `asset_snapshots` | 사용자 자산 그래프용 시점별 평가액 | 3 | 0.041MB | `kickx_member_data()` · `kickx_open_wallet()` |
| `ranking_snapshots` | 주간·월간 집계가 완료된 랭킹 결과 | 154 | 0.090MB | `server/kickx/public-prototype.ts:10` · `server/kickx/public-prototype.ts:9` · `kickx_auto_refresh_rankings()` · `kickx_member_data()` |
| `community_posts` | 구단·선수 게시글과 첨부 거래 | 2 | 0.066MB | `kickx_community_counts()` · `kickx_community_write()` |
| `community_comments` | 댓글·답글과 수정 상태 | 0 | 0.033MB | `kickx_community_write()` · `kickx_moderate()` |
| `community_likes` | 사용자별 게시글 공감과 중복 방지 | 0 | 0.008MB | `kickx_community_write()` · `kickx_post_json()` |
| `community_views` | 사용자·게시글·날짜별 조회 중복 방지 | 1 | 0.025MB | `kickx_community_write()` · `kickx_post_json()` |
| `community_reports` | 게시글·댓글 신고와 처리 결과 | 0 | 0.025MB | `server/kickx/ingestion.ts:23` · `server/kickx/ingestion.ts:28` · `kickx_community_write()` · `kickx_moderate()` |
| `community_revisions` | 게시글·댓글 변경 전 내용과 행위자 | 0 | 0.016MB | `kickx_community_write()` |
| `player_names` | 한글 이름·별칭·수동/자동 출처와 검수 정보 | 5,134 | 1.204MB | `scripts/lib/korean-catalog.mjs:69` · `scripts/lib/missing-korean-names.mjs:60` · `kickx_apply_automatic_name()` · `kickx_apply_korean_catalog()` |
| `player_match_records` | 선수 상세의 경기 전적을 위한 가공 조회 데이터 | 20,278 | 8.184MB | `server/kickx/catalog-pages.ts:52` · `apply_bsd_batch()` · `apply_football_batch()` |
| `player_season_summaries` | 수집된 경기의 득점·도움·출전시간 요약 | 4,620 | 1.253MB | `apply_bsd_batch()` · `apply_football_batch()` |

판정: 현재 기능에서 사용하며 유지.

### 수집과 자동화 보조 데이터 21개

| 테이블 | 역할 | 행 수 | 크기 | 현재 사용 근거 일부 |
| --- | --- | ---: | ---: | --- |
| `football_league_seasons` | 대회별 시즌 식별자와 데이터 제공 범위 | 14 | 0.090MB | `apply_bsd_batch()` · `apply_football_batch()` |
| `football_match_stats` | 선수·경기별 API 원본 및 정규화 통계 | 20,278 | 65.831MB | `server/kickx/engine/service.ts:28` · `apply_bsd_batch()` · `apply_football_batch()` |
| `football_event_sources` | 경기별 라인업·사건·추가 시간 등 계산 증거 | 1,977 | 15.704MB | `apply_bsd_batch()` · `kickx_publish_calculation()` |
| `football_entity_sources` | 대회·구단·선수 등 API 원본과 현재 시즌 정보 | 3,333 | 4.530MB | `scripts/lib/automatic-football.mjs:47` · `scripts/lib/realtime-football.mjs:119` · `finish_football_bulk()` · `kickx_apply_automatic_task()` |
| `calculation_queue` | 변경된 선수의 계산 예약·재시도·revision | 695 | 0.475MB | `scripts/lib/automatic-football.mjs:94` · `scripts/lib/realtime-football.mjs:93` · `kickx_ack_calculation()` · `kickx_dispatch_minute_worker()` |
| `calculation_revisions` | 계산을 발행했을 때의 결과·가격 계획 변경 기록 | 10,066 | 16.867MB | `kickx_publish_calculation()` · `kickx_publish_calculation_v1()` |
| `player_calculation_state` | 마지막 성공 입력 해시·규칙 버전과 중복 발행 방지 | 3,209 | 0.664MB | `kickx_publish_calculation()` · `kickx_publish_calculation_v1()` |
| `operation_audit` | 계산·관리자 조치·이름 반영 등 감사 기록 | 20,360 | 7.037MB | `scripts/lib/korean-catalog.mjs:76` · `scripts/lib/workbook-player-names.mjs:190` · `kickx_apply_korean_catalog()` · `kickx_auto_initialize_market_v1()` |
| `football_bulk_daily_budget` | 수동·자동 작업이 공유하는 외부 API 일일 요청 예산 | 11 | 0.057MB | `claim_football_bulk()` · `fail_football_bulk()` |
| `automation_state` | 정기 전체 갱신의 실행 잠금·마지막 성공 상태 | 1 | 0.066MB | `kickx_automatic_daily_finish_task()` · `kickx_automatic_daily_start()` |
| `automation_runs` | 정기 갱신 실행별 결과·오류·성공/실패 | 53 | 0.131MB | `kickx_automatic_daily_finish_task()` · `kickx_automatic_daily_start()` |
| `automation_daily_tasks` | 정기 전체 갱신의 단계별 중단·재개 위치 | 2,010 | 6.865MB | `scripts/lib/automatic-football.mjs:32` · `kickx_automatic_daily_finish_task()` · `kickx_automatic_daily_start()` |
| `automatic_fixture_checks` | 정기 갱신에서 과거 경기 정정을 다시 확인할 시점 | 218 | 0.074MB | `scripts/lib/automatic-football.mjs:25` · `scripts/lib/automatic-football.mjs:60` · `kickx_club_finish()` · `kickx_data_freshness()` |
| `name_mapping_checks` | 이름 자동 매핑 시도 결과와 다음 재확인 판단 | 4,031 | 0.909MB | `scripts/lib/player-names.mjs:64` · `scripts/lib/player-names.mjs:71` |
| `club_collection_tasks` | 추가 컵대회 수집을 날짜 경계 이후에도 재개할 작업 | 334 | 4.571MB | `scripts/lib/club-collection.mjs:27` · `kickx_club_fail()` · `kickx_club_finish()` |
| `club_competition_backfills` | 추가 대회 시즌의 과거 수집 완료 여부 | 9 | 0.033MB | `scripts/lib/club-collection.mjs:16` · `kickx_club_finish()` |
| `club_competition_discovery` | 당일 확인한 추가 대회 검색 결과 캐시 | 1 | 0.033MB | `scripts/lib/club-collection.mjs:12` · `scripts/lib/club-collection.mjs:14` |
| `realtime_worker_state` | 분 단위 경기 워커의 독립 실행 잠금·상태 | 1 | 0.033MB | `kickx_data_freshness()` · `kickx_dispatch_minute_worker()` |
| `realtime_fixture_tasks` | 방금 끝난 경기의 통계·라인업 등 수집 중간 단계 | 0 | 0.123MB | `scripts/lib/realtime-football.mjs:58` · `scripts/lib/realtime-football.mjs:70` · `kickx_dispatch_minute_worker()` · `kickx_realtime_due_fixtures()` |
| `realtime_fixture_checks` | 경기 상태와 최종 통계를 다시 확인할 시점 | 25 | 0.066MB | `scripts/lib/realtime-football.mjs:60` · `scripts/lib/realtime-football.mjs:64` · `kickx_realtime_due_fixtures()` |
| `realtime_calendar_checks` | 대회별 일정 검색 재개 위치와 다음 점검 시각 | 14 | 0.033MB | `scripts/lib/realtime-football.mjs:31` · `scripts/lib/realtime-football.mjs:39` |

판정: 현재 수집·계산에서 사용하며 유지.

### 수동 수집과 복구 데이터 3개

| 테이블 | 역할 | 행 수 | 크기 | 현재 사용 근거 일부 |
| --- | --- | ---: | ---: | --- |
| `football_sync_jobs` | 현재도 실행 가능한 BSD 단건 CLI 수집의 작업 이력 | 6 | 0.033MB | `scripts/sync-football.mjs:17` · `scripts/sync-football.mjs:23` |
| `football_bulk_runs` | 수동 대량 수집·복구 CLI 실행과 잠금 이력 | 1 | 0.082MB | `scripts/lib/bulk-sync.mjs:68` · `claim_football_bulk()` · `control_football_bulk()` |
| `football_bulk_tasks` | 수동 대량 수집·복구 CLI의 중단·재개 단계 | 517 | 0.418MB | `scripts/lib/bulk-sync.mjs:72` · `scripts/lib/bulk-sync.mjs:73` · `claim_football_bulk()` · `finish_football_bulk()` |

판정: 현재 CLI·관리자 상태 조회에서 참조, 기능 통합 시 정리 검토.

### 구 API 방식 데이터 1개

| 테이블 | 역할 | 행 수 | 크기 | 현재 사용 근거 일부 |
| --- | --- | ---: | ---: | --- |
| `football_player_seasons` | 구 API-Football 방식의 선수별 시즌 원본 통계 | 0 | 0.016MB | `apply_football_batch()` |

판정: 우선 제거 검토, 관련 구 함수도 함께 정리.

### 미구현 기능 예비 데이터 1개

| 테이블 | 역할 | 행 수 | 크기 | 현재 사용 근거 일부 |
| --- | --- | ---: | ---: | --- |
| `player_analyses` | 선수 전체에 대한 AI 분석 문구용으로 만들어 둔 예비 저장소 | 0 | 0.016MB | `server/kickx/catalog-pages.ts:53` |

판정: 경기별 AI 리포트 구현 시 구조 재설계.

