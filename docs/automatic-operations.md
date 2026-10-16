> 2026-10-17 변경: 진행·종료 경기는 별도 1분 작업으로 분리했습니다. 현재 운영 적용과 주기는 [추가 요구사항 적용](REQUIREMENTS_UPDATE_2026-10-17.md)을 확인하세요. 아래는 기존 유지보수 기반 설명입니다.

> 실행 절차와 최신 클로드 인계는 [자동 운영 상세](AUTOMATION_2026-10-09.md)를 먼저 확인하세요. 004를 이미 적용했다면 다시 실행하지 않고 새 005만 적용합니다.

# 자동 수집·게임 운영 — 2026-10-09

관리자는 회원·거래·커뮤니티를 관리한다. 데이터 수집·선수별 산정·가격 반영·랭킹·한국어 이름은 브라우저 세션 없이 자동 처리한다. 100,000P 기본 가치와 기존 Performance/가격 공식은 시범 정책이며 이번 작업은 공식을 변경하지 않는다.

## 최초 활성화

- 기존 SQL `202610090001`~`003` 적용 후, `supabase/migrations/202610090004_automated_operations.sql`만 1회 적용한다. 아직 가격 없는 BSD 선수에게 100,000P를 부여하고 기존 가격은 보존한다. 기존 경기 기록과 새 선수는 계산 큐에 들어간다.
- GitHub `hyun1290/kick-x-test` → Settings → Secrets and variables → Actions → New repository secret에서 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BSD_API_KEY`를 설정한다. URL은 기존 `NEXT_PUBLIC_SUPABASE_URL` 값이다. 서비스 역할 키와 BSD 키는 기존 값을 사용한다. Vercel에 입력한 환경변수가 자동 복사되지는 않는다.
- Actions → Automatic football operations → Run workflow로 처음 확인한다. 이후 기본 브랜치의 `7,22,37,52`분 스케줄이 실행한다. GitHub schedule은 지연/누락 가능하므로 종료 즉시 초 단위 반영을 보장하지 않는다. 공개 저장소의 표준 ubuntu-latest runner는 무료다. 60일 무활동 시 예약이 비활성화될 수 있다.

## 처리 흐름

1. 서비스 역할로 DB lease 획득. 중복 runner는 작업하지 않는다.
2. KST 날짜 기준 하루 한 번 현재 시즌·구단·선수단·선수 기본정보·최근 7일/향후 21일 일정 수집. 매 API 단계의 데이터와 후속 작업을 같은 DB 트랜잭션으로 저장한다. 실행이 끊기면 다음 실행이 저장된 단계를 이어간다.
3. 매 실행 최근 7일 경기 상태를 조회한다. 종료 경기 기록을 수집하며 킥오프 6시간 이내/불완전 기록은 15분, 이후는 6시간 후 재확인한다. 제공자 호출은 기존 v1/v2 병합 로직을 유지한다.
4. 변경된 경기 원본·선수 기록·새 선수는 계산 큐에 등록된다. 선수별 기존 엔진을 실행해 Performance·가격을 게시한다. 동일 hash는 반복 반영되지 않으며 source CAS와 큐 revision은 새 변경을 잃지 않게 한다. 불완전 정정은 기존 가격 보존 및 재시도한다.
5. 거래·지갑 개설·보유 선수 가치 변화 시 자산 스냅샷 트리거가 주/월 랭킹을 갱신한다. 주기 작업도 랭킹을 갱신해 기간 경계를 반영한다.
6. Wikidata 공개 한국어 이름을 원어명/별칭과 일 단위 생년월일로 대조해 최대 100명씩 적용한다. 고유 후보가 없으면 원어명을 유지한다. 미일치는 30일 후, 공개 서비스 오류는 다음 날 재시도한다. 수동 확정 표기는 덮어쓰지 않는다. 전원 한국어 표기 확보를 보장하지 않는다.

## 실행·진단

```sh
npm ci
npm run data:automatic
```

`.env.local` 또는 runner 환경에 위 3개 값을 사용한다. 인증키를 CLI 인자나 로그에 넣지 않는다. 작업마다 최대 3,000 API 시도, DB 공유 일일 상한 7,000 요청이다. 조회 결과는 자동 작업 테이블에 보관하고 운영 로그는 상태 코드/건수만 출력한다. 자동 작업은 관리자 로그인이나 열린 페이지를 요구하지 않는다.

- `automation_state`: 마지막 일일 완료일, 성공 시각, 오류 및 lease.
- `automation_daily_tasks`: 날짜별 진행 단계. 데이터 저장과 체크포인트가 함께 커밋된다.
- `automation_runs`: 실행별 요청·처리 수·오류 요약.
- `calculation_queue`: 변경 선수, revision, 재시도 시각과 사유.
- `name_mapping_checks` / `player_names`: 이름 매핑 상태/출처. 미확인 이름은 확정 번역으로 만들지 않는다.

자동화는 service_role만 호출 가능하다. 일반 회원은 운영 테이블을 읽거나 직접 가격·잔액을 수정할 수 없다. 회원 제한은 1/7/30일 또는 해제, 5~500자 사유, 관리자 자신/다른 관리자 보호를 지원하고 거래·스쿼드·커뮤니티·프로필 변경을 차단한다.

## 검증 범위

lint, 단위 테스트, 전체 migration 및 독립 DB 통합 검사, Next.js build/typecheck, 데스크톱/모바일 브라우저 흐름을 검증한다. 운영 SQL 적용·secrets 등록·실제 BSD 호출 성공은 별도의 운영 활성화 단계이며 코드 테스트 통과와 구분한다.

참고: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows · https://docs.github.com/en/billing/concepts/product-billing/github-actions · https://www.mediawiki.org/wiki/Wikibase/API
