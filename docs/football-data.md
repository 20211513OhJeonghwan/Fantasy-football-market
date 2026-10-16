# BSD 수집과 실제 연결

기준: 2026-10-03 KST. 축구 제공자는 BSD 무료 Football REST API로 확정했다. v2를 기본으로 사용하고 페널티킥 선방은 v1 `/api/player-stats/`로 보완한다. 기존 화면·검색·페이지네이션은 유지한다. 거래는 시스템 상대이며 사용자 수요가 가격을 결정하지 않는다.

사용자가 단건 실적재·재수집·실제 선수/소속 표시를 확인했다. 다음은 **5대 리그 전체 적재**이며 [관리자 버튼/전체 CLI 실행 안내](manual-refresh.md)를 따른다. 새 SQL `202610030001_manual_bsd_refresh.sql`과 `npm run data:sync:all`이 추가됐다. 아래 단건 명령은 개별 검증·진단 용도로 유지한다.

## 적용 순서

1. 이미 적용한 `202610010001`, `202610010002`는 재실행하지 않는다. 새 `supabase/migrations/202610020001_bsd_ingestion.sql`을 SQL Editor 또는 기존 마이그레이션 흐름으로 한 번 적용한다. 기존 `af-` 행과 참조는 보존하며 자동 삭제/병합하지 않는다.
2. 수집 실행 컴퓨터의 `.env.local`에 `BSD_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 설정한다. 브라우저용 키는 기존 publishable/anon 키를 유지한다. 수집 키를 `NEXT_PUBLIC_`로 만들지 않는다. 방문자가 페이지를 열 때 외부 API를 호출하지 않는다.
3. `npm ci` 후 `npm run connection:check`로 카탈로그/새 BSD 열/Google Provider 상태를 확인한다. 사용자에게 기존 SQL·환경·Google 설정 완료 보고가 있었으며, 이번 작업 환경에는 키가 전달되지 않아 운영 검증은 별도로 남아 있다.
4. 아래 읽기 전용 discovery로 리그와 시즌 ID를 얻는다. API-FOOTBALL 리그 ID나 연도를 BSD ID 대신 넣지 않는다.
5. 한 경기 dry-run → 현재 구단·선수단 적재 → 같은 경기 저장 → DB/API/화면 비교 → 동일 명령 재실행 순으로 확인한다. 시즌 전체 수집은 소량 적재 확인 후 진행한다.

## CLI

아래는 실행 예시다. `LEAGUE_ID`, `SEASON_ID`, `TEAM_ID`, `EVENT_ID`를 discovery와 BSD 응답에서 확인한 숫자로 바꾼다. `--season-id`는 제공자 시즌 ID이고 DB의 표시용 `season`은 응답의 시작 연도다.

```bash
npm run data:sync -- discover --limit=200 --pages=1 --budget=2
npm run data:sync -- seasons --league=LEAGUE_ID --budget=2
npm run data:sync -- leagues --league=LEAGUE_ID --season-id=SEASON_ID --budget=5 --dry-run
npm run data:sync -- teams --league=LEAGUE_ID --season-id=SEASON_ID --limit=200 --pages=1 --budget=5 --dry-run
npm run data:sync -- squads --league=LEAGUE_ID --season-id=SEASON_ID --team=TEAM_ID --budget=10 --dry-run
npm run data:sync -- fixtures --league=LEAGUE_ID --season-id=SEASON_ID --from=2026-09-19 --to=2026-09-21 --limit=50 --pages=1 --budget=5 --dry-run
npm run data:sync -- matches --league=LEAGUE_ID --season-id=SEASON_ID --fixture=EVENT_ID --budget=50 --dry-run
```

`discover`, `seasons`는 DB 없이 읽기만 한다. 다른 명령의 `--dry-run`은 실제 BSD 요청·정규화를 수행하되 DB에 쓰지 않는다. DB 저장 시 해당 명령에서 `--dry-run`을 제거한다. `players`는 `--team=TEAM_ID`가 필수인 현재 팀 선수 프로필 목록이다. BSD에는 API-FOOTBALL 방식의 리그별 선수 시즌 목록이 없으므로 시즌 합계를 만들어 넣지 않는다.

목록 작업(discover/teams/players/fixtures)은 `--offset`, `--limit`(최대 200), `--pages`로 제어한다. 한 실행 예산은 `--budget`(기본 10, 최대 500)이며 재시도도 포함한다. 출력의 `nextOffset`이 남으면 동일 조건과 그 offset으로 이어간다. 성공적으로 저장한 페이지 뒤에만 커서를 전진시킨다. fixture 날짜 범위는 UTC 날짜, 최대 31일 간격이다. 화면의 날짜 구분은 기존 한국 시간 기준을 유지한다.

경기 작업은 리그·시즌 확인 → 경기 상세 → 선수 통계 → 라인업 → incidents → v1 보완의 순서다. 확인된 라인업에 없는 선수는 프로필을 추가 조회한다. 여러 v1 페이지를 모두 읽고 정상화한 뒤 한 RPC로 저장한다. 중간에 예산/네트워크 오류가 발생하면 해당 경기의 일부만 저장하지 않는다. 경기 작업 중단 시 같은 EVENT_ID를 재실행한다.

## 저장 계약

- 내부 ID `bsd-<BSD id>`, 숫자 `external_id`, `provider='bsd'`. 기존 외부 ID 고유 제약은 `(provider, external_id)`로 전환해 같은 숫자의 `af-`와 충돌하지 않는다. 기존 자료를 실제 BSD 인물과 연결하려면 별도의 확인된 매핑이 필요하다.
- `football_league_seasons.provider_season_id`, `fixtures.provider_season_id`에 BSD 시즌 ID를 보존한다. 같은 리그·시작 연도에 두 시즌 ID가 들어오면 자동 덮어쓰지 않고 거부한다.
- `football_match_stats.stats`는 원본 flat BSD JSON. `legacy_stats`는 v1 원본. `normalized`는 `version`, `values`, 항목별 `quality`, `calculation_ready`를 가진 공급자 중립 통계다.
- `football_event_sources`는 경기 상세·라인업·득점/교체/카드 incidents·v1/v2 응답을 보존한다. 목록 재조회는 기존 세부 원천을 지우지 않는다. 이 테이블과 원천 통계/작업 이력은 공개 API에 노출하지 않는다.
- `apply_bsd_batch`는 service_role만 실행한다. 참조·선수 경기 당시 팀·완성된 경기 snapshot을 확인하고 원본/표준/공개 기록을 한 트랜잭션으로 저장한다. BSD 수집을 직렬화해 경기 간 합계 갱신 경합을 막는다.
- 동일 경기 재실행은 player/fixture 키로 교체한다. 정상적인 비어 있지 않은 전체 통계 snapshot은 정정으로 빠진 선수의 이전 기록도 제거한다. 비어 있는 응답은 기존 기록을 자동 삭제하지 않는다.
- `player_season_summaries`의 BSD 합계는 `stats_scope='imported_matches'`, `matches_imported`를 가진 부분 합계다. 화면은 “수집된 N경기”로 표시한다. 하나라도 미확인인 지표의 전체 합계는 null이다.
- 과거 경기 팀/포지션/등번호로 현재 선수단을 덮어쓰지 않는다. 현재 소속은 squads/현재 팀 players 작업에서만 바꾼다. 과거 경기에서 발견한 팀에는 현재 리그 소속을 임의로 붙이지 않는다.
- BSD 사진은 `/img/player/{id}/?sor=true&bg=transparent`로 연결한다. 이미지 204/실패 시 기존 일러스트로 돌아간다.
- 가격/Performance/지갑/거래는 이 importer가 채우지 않는다. 공급자 rating/market_value도 KICK-X 값으로 복사하지 않는다.

## 미제공 통계 처리

BSD 공식 PlayerStatV2Schema는 미제공 카운터를 0으로 반환할 수 있다고 명시한다. 따라서 원본 0은 보존하되 내부에는 null + `unverified_zero`로 둔다. 양수는 `reported`, 미존재/null은 `missing`, 양수 페널티 선방은 `legacy_v1`이다. 단순히 응답 키가 있다는 이유로 전체 제공 여부를 확정하지 않는다.

성공 크로스는 `accurate_cross`, 성공 태클은 `won_tackle`, 패스 성공은 `accurate_pass`다. 30회/85% 조건은 계산 엔진에서 적용한다. 클린시트·출전 중 실점·자책골/카드 재조정은 라인업/incident 완전성과 출전 구간을 검증한 뒤 계산해야 한다. 현재는 null과 `calculation_ready=false`로 남긴다. 특히 GK 실점을 DF에게 복사하지 않는다. 이는 가치 계산 단계의 선행 검증 과제다.

## 예산·오류

공식 무료 일일 한도는 7,500회, UTC 자정 초기화다. `RateLimit` 구조화 헤더를 라이브러리로 파싱하고 429의 `taster_exhausted`(일일 한도)/순간 제한을 구분한다. `Retry-After`는 안전한 숫자만 기록한다. 429에서는 대기 상태로 종료하고 알려준 시간 이후 재실행한다. 5xx/네트워크는 최대 세 번, 모든 시도를 예산에 포함한다. 키나 원천 오류 본문은 로그에 출력하지 않는다. 고정 호스트와 리다이렉트 거부로 키 유출을 막는다.

기존 단건 CLI는 provider/요청 횟수/행 처리 횟수/next_offset/오류/재개 대기를 남기며 DB 중앙 일일 예산에 포함되지 않는다. 새 전체 수집 CLI/관리자 버튼은 동일한 DB 큐와 UTC 일일 7,000회 예약 예산을 공유한다. 외부 도구가 같은 BSD 키로 사용한 호출량은 BSD 응답의 남은 쿼터/429로 확인한다. 자동 실행은 사용자 요청에 따라 보류한다.

## 확인할 실제 흐름

- BSD 응답의 선수 ID·경기 ID·팀·분·득점/도움·사진이 DB와 `/api/kickx/players`, `/api/kickx/players/{bsd-id}`, `/api/kickx/fixtures`에 맞는지 비교한다.
- 같은 경기 저장을 반복해 기록 개수·분 합계가 증가하지 않는지 확인한다.
- 이미지 실패/null 표시, 한국 날짜 경계, 검색·포지션·리그 필터를 확인한다.
- Google 실제 로그인→프로필/관심 목록 저장→재로그인 유지와 계정 간 격리는 별도 운영 검증이다.

로컬 검증: 단위 검사, 추가 SQL의 권한/재수집/정정/부분 합계 검사, build, 화면 검사를 실행한다. 주입 응답과 임시 DB 통과를 운영 BSD/Supabase 적재 완료라고 표현하지 않는다.

공식 자료: [BSD Football](https://sports.bzzoiro.com/docs/football/), [Events](https://sports.bzzoiro.com/docs/football/events/), [Teams/Players](https://sports.bzzoiro.com/docs/football/teams-players/), [Limits](https://sports.bzzoiro.com/docs/conventions/), [Images](https://sports.bzzoiro.com/docs/images/), [OpenAPI schema](https://sports.bzzoiro.com/api/schema/).
