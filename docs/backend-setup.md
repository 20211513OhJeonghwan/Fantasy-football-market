# DB와 로그인 연결 안내

사용자는 기존 환경변수·SQL·Google 설정과 BSD 소량 적재·연결 확인을 마쳤습니다. 이번 추가 사항은 [수동 갱신 안내](manual-refresh.md)의 새 SQL·관리자 역할입니다. 실제 Google 로그인/저장 유지와 계정 간 격리는 별도 운영 검증입니다. 비밀키를 채팅이나 GitHub에 올리지 마세요.

## 1. 마이그레이션

1. 사용할 Supabase 프로젝트를 확인합니다.
2. `supabase/migrations/`의 SQL을 파일명 순서대로 검토하고 SQL Editor 또는 기존 Supabase CLI 마이그레이션 흐름으로 한 번씩 적용합니다. 이미 적용한 파일은 다시 실행하지 않습니다. 두 번째 파일은 축구 원천 기록·요약·작업 이력·페이지 조회 뷰를 추가하며, 세 번째 파일은 BSD 식별자·원천/표준 통계·사진·부분 합계를 추가합니다.
3. 같은 이름의 기존 테이블이 있으면 그대로 실행하지 말고 기존 스키마와 대조해 별도 마이그레이션을 만듭니다. 파일은 기존 테이블을 삭제하거나 자동 덮어쓰지 않습니다.

포함 테이블: leagues, teams, players, player_market_snapshots, fixtures, price_history, player_match_records, player_analyses, profiles, user_roles, watchlists.

샘플 행·포인트·가격·관리자·포메이션을 삽입하지 않습니다. 지갑/거래/보유/선수단/커뮤니티 테이블은 이번 마이그레이션 범위에 없습니다. 원천 데이터 수집 계정만 카탈로그를 적재하도록 운영해야 합니다.

- 카탈로그: 공개 읽기, 일반 회원 쓰기 금지.
- profiles: 본인 조회/등록/닉네임·구단 수정만 허용. 역할이나 ID 수정 불가.
- user_roles: 본인 역할 조회만 허용. 운영자가 안전한 서버 또는 SQL 관리 경로에서 지정.
- watchlists: 본인 조회/추가/삭제. 사용자·선수 조합 고유키로 중복 추가 방지.

## 2. Google 로그인

Supabase Authentication에서 Google 공급자를 활성화하고 Google OAuth Client ID/Secret을 설정합니다. Google의 승인된 리디렉션 URI에는 Supabase가 안내하는 `https://<project-ref>.supabase.co/auth/v1/callback`을 사용합니다.

Supabase의 Site URL은 `https://kick-x-test.vercel.app`로 설정하고 Redirect URLs에 다음을 등록합니다.

- `https://kick-x-test.vercel.app/auth/callback`
- 개발용 `http://localhost:3000/auth/callback`
- Preview 로그인까지 시험할 경우에만 해당 Preview 호스트의 콜백

내부 복귀 경로는 검증한 뒤 10분짜리 HttpOnly 쿠키에 보관하고 콜백에서 제거합니다. OAuth의 callback URL에는 별도 next 쿼리를 붙이지 않으므로 위의 정확한 경로를 등록하면 됩니다.

인증 흐름은 POST 로그인 시작 → Google → Supabase → GET /auth/callback → 기존 회원은 요청 페이지, 신규 회원은 프로필 등록입니다. PKCE 코드 교환과 서버 `getUser()` 검증을 사용합니다. 브라우저가 보낸 userId·role·session 객체를 인증 자료로 사용하지 않습니다.

현재 데이터 접근은 Route Handler에서만 실행하므로 쿠키 갱신도 그 응답에서 처리합니다. 향후 Server Component에서 Supabase를 직접 사용하면 Next.js 버전에 맞는 세션 갱신 proxy를 추가해야 합니다.

## 3. 환경변수

Vercel과 로컬 개발 환경에 설정합니다.

| 이름 | 값 |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | 해당 프로젝트의 HTTPS URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | publishable 키 또는 기존 anon 키 |
| KICKX_DATABASE_ENABLED | SQL/OAuth 설정을 마친 뒤 true |

서비스 역할 키는 일반 공개 조회·사용자 저장 경로에 필요하지 않습니다. 수동 수집 CLI와 관리자 갱신 서버에는 별도의 `SUPABASE_SERVICE_ROLE_KEY`와 `BSD_API_KEY`가 필요합니다. 로컬 실행은 `.env.local`, 배포 관리자 버튼 실행은 Vercel 해당 환경에 설정합니다. 기존 `NEXT_PUBLIC_SUPABASE_ANON_KEY`도 대체 키 이름으로 지원합니다. 환경변수 변경 후 재시작/재배포합니다. 미설정/false 상태에서는 빈 UI와 준비 안내를 유지합니다.

설정 후 `npm run connection:check`로 공개 테이블·목록 뷰 접근과 Google 공급자 활성화를 확인합니다. 이 명령은 설정 존재 여부와 검사 결과만 출력하며 OAuth 리디렉션·실제 회원 쓰기는 아래 통합 시험으로 확인해야 합니다. 축구 적재는 [football-data.md](football-data.md)의 실행 순서를 따릅니다.

## 4. 실제 계정으로 확인할 흐름

- 비로그인 상태에서 공개 선수·경기만 조회되는지 확인합니다.
- Google 로그인 → 신규 프로필 저장 → 새로고침 → 재로그인으로 프로필이 유지되는지 확인합니다.
- 다른 계정과 닉네임 중복 시 409가 반환되는지 확인합니다.
- 실제 적재한 선수의 관심 버튼 추가/해제 → 새로고침 → 다른 기기에서도 같은지 확인합니다.
- 일반 회원이 다른 사용자의 프로필·관심 선수·역할을 읽거나 수정할 수 없는지 확인합니다.
- 초기 포인트나 가짜 보유 선수가 생기지 않는지 확인합니다.
- 로그아웃 뒤 개인 정보가 사라지는지 확인합니다.

## 구현 한계와 정책

닉네임 2–20자, 문자·숫자·공백·밑줄·하이픈, 대소문자 무시 중복 금지는 이번 입력 검증 기본값입니다. 팀의 최종 운영 정책으로 확정된 값이 아닙니다. `lib/kickx/validation.ts`와 DB 제약을 함께 변경해야 합니다. 응원 구단은 선택 사항이고 현재 프로필 변경은 허용합니다. 커뮤니티 쓰기 활성화 전에 구단 변경 제한·작성 권한을 확정하세요.

초기 포인트 금액이 미정이므로 프로필 생성 때 지갑/포인트를 생성하지 않습니다. 금융 데이터는 `financialReady: false`로 전달해 거래 합계와 보유 수량도 미확정으로 표시합니다. 거래 API·원장·집계 구현과 함께 이 상태를 바꿔야 합니다.

리그/구단/선수/경기는 실제 데이터만 적재하세요. Performance/가격은 계산 규칙 버전 없이 저장할 수 없게 제약했습니다. 가격 이력은 player_id+recorded_at, 경기 기록은 player_id+fixture_id로 중복을 방지합니다. 원천 수집은 트랜잭션·실행 이력·재실행 upsert를 지원합니다. 관리자 전체 수집 UI와 원천 재수집은 구현했고, 경기 정정에 따른 계산 결과 재계산과 개별 계산 작업 재처리는 아직 구현 전입니다.

자료: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Google 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
