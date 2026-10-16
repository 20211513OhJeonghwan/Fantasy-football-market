> 과거 전체 수집 및 개발자 복구 기록입니다. 2026-10-09 사용자 정정으로 관리자 수동 버튼과 아래 일상 실행 절차는 폐기했습니다. 이미 적용된 SQL을 다시 실행하지 않습니다. 현재 운영은 [자동 운영 설정](AUTOMATION_2026-10-09.md)을 따릅니다.

# 5대 리그 수동 갱신 실행 안내

이번 기능은 관리자 클릭 또는 CLI 명령으로 시작한다. 자동 예약 실행은 없다. 사용자 PC에서 확인한 BSD·Supabase 키를 그대로 사용하며 키 값을 코드에 넣지 않는다.

## 1. 최신 코드와 새 SQL

아래는 사용자 PC에서 실행하는 전체 명령이다. 작업 중인 변경이 없는 `main`을 기준으로 한다. 변경 사항이 있다면 먼저 보존하고 진행한다.

```powershell
cd C:\next\kickx
git switch main
git pull --ff-only origin main
npm ci
```

기존 001·002·BSD 003까지 적용했다면 Supabase SQL Editor에서 **`supabase/migrations/202610030001_manual_bsd_refresh.sql`의 전체 내용만 한 번 실행**한다. 기존 파일은 다시 적용하지 않는다. 새 테이블은 수집 실행·세부 작업·일일 호출 예약·구단/선수 원본이며, 기존 선수/경기를 지우지 않는다.

SQL 적용 후 CLI 전체 수집은 바로 가능하다. 관리자 페이지 버튼을 쓰려면 2절의 관리자 역할도 지정한다.

## 2. 관리자 계정 지정 — 최초 한 번

Google 로그인한 계정이 Supabase Authentication > Users에 존재해야 한다. 아래는 SQL Editor에서 실행할 전체 SQL이며, `본인 Google 이메일`만 실제 로그인 이메일로 바꾼다. 다른 회원을 일괄 승격하지 않는다.

```sql
insert into public.user_roles (user_id, role)
select id, 'admin'
from auth.users
where lower(email) = lower('본인 Google 이메일')
on conflict (user_id) do update set role = excluded.role;

select u.email, r.role
from auth.users u
join public.user_roles r on r.user_id = u.id
where lower(u.email) = lower('본인 Google 이메일');
```

조회 결과가 본인 이메일과 `admin` 1행이어야 한다. 0행이면 로그인 계정/이메일을 확인한다. 역할은 클라이언트에서 설정할 수 없으며 API가 매 요청마다 서버 세션과 DB 역할을 검증한다.

## 3. 실행 위치에 따른 환경변수

| 실행 위치 | 설정 위치 | 필요한 값 |
| --- | --- | --- |
| 로컬 CLI | 프로젝트 `.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BSD_API_KEY` |
| 로컬 관리자 화면 | 프로젝트 `.env.local` | 위 값 + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `KICKX_DATABASE_ENABLED=true` |
| 배포된 관리자 화면 | Vercel 해당 배포 환경 | 로컬 관리자 화면과 같은 변수 이름을 설정한 후 재배포 |

`SUPABASE_SERVICE_ROLE_KEY`는 서버용 service_role/secret 키이며 publishable 키와 다르다. `BSD_API_KEY`와 함께 `NEXT_PUBLIC_` 접두어를 붙이지 않는다. 로컬 `.env.local`은 Git으로 전송하지 않는다. 로컬 키를 설정했다고 Vercel에도 자동 반영되는 것은 아니다.

## 4. 전체 적재

### 관리자 버튼

전체 실행 명령:

```powershell
npm run dev
```

`http://localhost:3000`에서 Google 로그인 → `/admin/data` → **5대 리그 데이터 갱신**을 누른다. 이 페이지를 열어 두면 단계별로 DB에 저장한다. 시간이 걸리는 첫 적재에는 아래 CLI도 사용할 수 있다.

- **일시 중지**: 현재 요청이 끝난 뒤 멈춘다.
- **이어서 실행**: DB에 저장된 지점부터 진행한다. 새로고침/브라우저 종료 후에도 가능하다.
- **수집 종료**: 남은 작업을 취소한다. 이미 적재된 데이터는 유지한다. 이후 새 갱신으로 다시 수집할 수 있다.
- **상태 새로고침**: 조회만 하며 새 수집을 시작하지 않는다.
- 다른 창/CLI가 처리 중이면 중복 진행하지 않는다. 중단된 서버 요청은 최대 90초 뒤 점유가 만료된다.
- 한도/일시 제한이면 표시된 재개 가능 시각 이후 직접 이어서 실행한다. 대기 시간이 지나도 스스로 실행되지 않는다.

### 같은 작업 큐를 쓰는 CLI

각 줄은 용도별 완전한 명령이며, 한꺼번에 모두 실행하는 순서가 아니다.

```powershell
# 처음 시작 또는 실행 중인 작업 이어받기
npm run data:sync:all

# 일시 중지/일일 한도 후 재개
node scripts/sync-football-all.mjs --resume

# 현재 상태 조회만 하기
node scripts/sync-football-all.mjs --status
```

CLI는 Ctrl+C로 현재 단계 후 중지한다. 오류 코드는 키/원본 오류 본문 없이 출력된다. 정상 완료 또는 정상 단일 단계 진단은 종료 코드 0, 중지/다른 작업 진행 중은 2, 설정/실행 오류는 1이다.

### 첫 리그에서 `INVALID_EXTERNAL_ID`로 중지된 경우

2026-10-03 수정 전 코드는 현재 시즌 응답을 평탄한 객체로 읽었다. BSD 공식 OpenAPI의 실제 계약은 `{league_id, season: {...}}`이며, 수정된 코드는 리그 ID를 확인하고 `season.id`를 사용한다. 현재 시즌이 없거나 날짜가 잘못된 응답은 적재하지 않고 중지한다. 원본 응답도 함께 보존한다.

최신 `main`을 받은 뒤 아래 **전체 PowerShell 명령**으로 기존 작업을 재개한다. 환경변수 변경·SQL 재실행·작업 삭제는 필요하지 않다. 저장된 `seasons` 체크포인트부터 이어진다.

```powershell
cd C:\next\kickx
git pull --ff-only origin main
node scripts/sync-football-all.mjs --resume
```

### DB 오류 진단과 기존 작업 재개

`BULK_DATABASE_ERROR`로 종료됐으면 최신 코드를 받은 후 아래 전체 PowerShell 명령으로 상태를 확인하고 **기존 작업의 한 단계만** 진단한다. SQL 재실행이나 작업 삭제는 하지 않는다. 재개 응답이 `busy`이면 다른 작업 또는 최대 90초의 점유권이 남아 있으므로, 점유권 만료 후 다시 실행한다. `cooldown`이면 표시된 `retry_at` 이후에 직접 재개한다.

```powershell
cd C:\next\kickx
git pull --ff-only origin main
node scripts/sync-football-all.mjs --status
node scripts/sync-football-all.mjs --resume --once
```

진단 실행은 정상 처리 한 단계 후 종료한다. 전체 재개는 `node scripts/sync-football-all.mjs --resume`이다. 오류 출력의 `operation`은 실패한 DB 작업, `databaseCode`는 SQLSTATE/PostgREST 코드이며, `phase`/`eventId`는 해당 경기 처리 지점이다. DB 메시지·원본 응답·SQL·키는 출력하지 않는다. DB 저장 응답을 잃었을 때 실패 상태를 추가로 덮어쓰지 않으며, 다음 실행은 DB 체크포인트와 점유권을 기준으로 이어간다. 원인이 확정되지 않은 운영 DB 오류를 이 변경만으로 해결했다고 판단하지 않는다.

## 5. 수집하는 데이터

| 대상 | 수집 범위 |
| --- | --- |
| 리그/시즌 | EPL 1, 라리가 3, 세리에 A 4, 분데스리가 5, 리그 1 6. 현재 시즌 ID는 API에서 확인 |
| 구단/선수 | 시즌 참가 구단, 현재 선수단, 선수 목록 프로필, 이름·포지션·등번호·제공되는 국가/생년월일·사진 URL |
| 일정 | 현재 시즌 시작~종료 전체. 30일 구간·모든 페이지 |
| 종료 경기 | 상세, 선수별 통계, 선발/교체명단, 득점·교체·카드 사건, v1 페널티 선방 보완 |
| 보완 정보 | 라인업에 없는 통계 대상 선수는 선수 상세 추가 조회 |
| DB | 원본 JSON, 내부 표준 통계, 공개 목록/상세 요약, 수집 진행·오류·호출량 |

과거 모든 시즌, 배당·예측·뉴스는 이번 범위가 아니다. 선수 가격/Performance/포인트/거래는 외부 API에서 가져오는 값이 아니며 후속 계산·정산 기능에서 만든다. 사진 파일을 모두 복제하지 않고 BSD Image URL을 연결한다.

## 6. 실제 적재 결과 확인

1. 관리자에서 완료 작업 수·경고·요청 횟수를 확인한다. `rows_written`은 신규 선수 수가 아니다.
2. `/players`에서 5개 리그 필터와 검색·다음 페이지, 실제 선수 상세의 소속/사진/최근 기록을 확인한다. `/fixtures`에서 해당 경기 날짜를 선택한다.
3. 다음은 SQL Editor에서 실행하는 읽기 전용 검증용 전체 SQL이다.

```sql
select l.name,
  (select count(*) from public.teams t where t.league_id=l.id and t.provider='bsd') as teams,
  (select count(*) from public.players p join public.teams t on t.id=p.team_id where t.league_id=l.id and p.provider='bsd') as current_players
from public.leagues l
where l.provider='bsd' and l.id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')
order by l.id;

select l.name, f.season, f.provider_season_id,
  count(*) as fixtures,
  count(*) filter(where f.status in ('FT','AET','PEN')) as finished,
  count(*) filter(where e.player_stats is not null) as with_player_stats
from public.fixtures f join public.leagues l on l.id=f.league_id
left join public.football_event_sources e on e.fixture_id=f.id
where f.provider='bsd' and l.id in ('bsd-1','bsd-3','bsd-4','bsd-5','bsd-6')
group by l.name, f.season, f.provider_season_id order by l.name, f.season desc;

select id, status, completed_tasks, total_tasks, warnings, requests, error_code
from public.football_bulk_runs order by started_at desc limit 5;

select t.label, t.warning
from public.football_bulk_tasks t
where t.run_id=(select id from public.football_bulk_runs order by started_at desc limit 1)
  and t.warning is not null;
```

미제공 통계 경고가 있으면 해당 경기 통계는 완전하지 않다. BSD 기본값 0과 실제 0의 구분, 클린시트·출전 중 실점 검증도 아직 계산 준비 과제다. 원천 수집 완료를 가격 계산 완료로 해석하지 않는다.

이번 개발 작업은 운영 키를 보유하지 않은 환경에서 수행했다. 새 전체 적재 명령의 운영 DB 행 수·성공 결과는 위 실행 후 확인해야 하며, 테스트 DB 결과로 대신하지 않는다.
