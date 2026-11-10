import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http";
export { FORMATIONS } from '@/lib/kickx/squad';
const messages: Record<string,string>={PRIMARY_TEAM_IMMUTABLE:"메인 응원 구단은 영구 고정되어 변경할 수 없습니다.",PRIMARY_TEAM_REQUIRED:"메인 응원 구단을 선택해 주세요.",PRIMARY_CONFIRMATION_REQUIRED:"메인 응원 구단은 영구 변경 불가 안내를 확인해야 설정할 수 있습니다.",SUBTEAM_WINDOW_CLOSED:"서브팀은 가입 후 1시간 또는 2월·9월 1~7일에만 변경할 수 있습니다.",SUBTEAM_ALREADY_CHANGED:"이 리그의 서브팀은 이번 변경 주간에 이미 변경했습니다.",PARTICIPATION_REQUIRED:"댓글·공감·투표는 메인 응원 구단과 서브팀 게시판에서만 가능합니다.",POLL_CLOSED:"종료된 투표이거나 투표가 없는 글입니다.",INVALID_POLL:"투표 질문과 서로 다른 선택지 2~6개를 확인해 주세요.",POSITION_FULL:"해당 포지션의 보유 정원이 찼습니다. 현재 포메이션의 포지션별 보유 현황을 확인하거나 포메이션을 변경해 주세요.",POSITION_UNAVAILABLE:"포지션 정보가 없는 선수는 매입할 수 없습니다.",MATCH_TRADING_LOCKED:"경기 시작 90분 전부터 종료 확인 후 10분까지 해당 선수의 매입·매각이 제한됩니다.",MEMBER_SUSPENDED:"이용 제한 중에는 거래·스쿼드·커뮤니티를 변경할 수 없습니다.",PROTECTED_ADMIN:"관리자 계정은 이 화면에서 이용 제한할 수 없습니다.",RULE_VERSION_MISMATCH:"계산 엔진과 정책 버전이 다릅니다. 운영 설정을 확인해 주세요.",AUTH_REQUIRED:"로그인해 주세요.",PROFILE_REQUIRED:"닉네임과 응원 구단을 먼저 설정해 주세요.",ADMIN_REQUIRED:"관리자 권한이 필요합니다.",PRICE_RECALCULATING:"새 가격 규칙으로 산정 중입니다. 잠시 후 다시 확인해 주세요.",PRICE_UNAVAILABLE:"아직 가치가 산정되지 않은 선수입니다.",TRADING_PAUSED:"거래가 중지된 선수입니다.",OUTSIDE_MARKET_SCOPE:"현재 5대 리그 소속 선수만 새로 영입할 수 있습니다.",ALREADY_OWNED:"이미 보유한 선수입니다. 같은 선수는 한 명만 보유할 수 있습니다.",NOT_OWNED:"보유한 선수만 판매할 수 있습니다.",INSUFFICIENT_POINTS:"보유 포인트가 부족합니다.",QUOTE_EXPIRED:"견적이 만료되었습니다. 새 견적을 확인해 주세요.",PRICE_CHANGED:"가격이 변경되었습니다. 새 견적을 확인해 주세요.",QUOTE_NOT_FOUND:"견적을 찾을 수 없습니다.",REQUEST_REUSED:"이미 사용한 요청입니다. 새로고침해 주세요.",STALE_REVISION:"다른 창에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.",INVALID_SQUAD:"선택한 포메이션의 11개 자리를 확인해 주세요.",INVALID_SQUAD_PLAYER:"보유 여부와 포지션을 확인해 주세요.",DUPLICATE_PLAYER:"같은 선수를 중복 배치할 수 없습니다.",FAN_REQUIRED:"게시글은 메인 응원 구단에만 작성할 수 있습니다.",NOT_AUTHOR:"작성자만 수정하거나 삭제할 수 있습니다.",POST_NOT_FOUND:"게시글을 찾을 수 없습니다.",REPORT_NOT_FOUND:"신고를 찾을 수 없습니다.",TRADE_NOT_OWNED:"본인의 거래만 첨부할 수 있습니다.",TOO_FAST:"잠시 후 다시 작성해 주세요.",INVALID_TARGET:"대상을 확인해 주세요.",INVALID_PARENT:"답글 대상을 확인해 주세요.",INVALID_INPUT:"입력 내용을 확인해 주세요.",INVALID_ACTION:"지원하지 않는 요청입니다.",SOURCE_CHANGED:"원본이 변경되었습니다. 계산을 다시 실행해 주세요."};
export function migrationMissing(error: {code?:string;message?:string}|null) {return !!error && (["42P01","42883","PGRST202","PGRST205"].includes(error.code??""));}
export function checkDatabase(error:{code?:string;message?:string}|null) {
 if(!error)return;
 if(error.message==='BENCH_EXPIRED')throw new HttpError(409,'7일 보관 기한이 지나 자동 매각 처리 중입니다. 거래 내역에서 확인해 주세요.');
 if(error.message==='ROSTER_PRICE_UNAVAILABLE')throw new HttpError(409,'변경 전 마지막 가격을 확인하지 못했습니다. 선수 데이터 갱신을 확인해 주세요.');
 const squadMessages:Record<string,string>={NOT_BENCHED:"이미 주전인 선수입니다. 최신 스쿼드를 확인해 주세요.",INVALID_FORMATION:"지원하는 포메이션을 선택해 주세요.",INVALID_BENCH_SELECTION:"초과 포지션별 필요한 인원만 벤치 이동 선수로 선택해 주세요. 보유 현황이 바뀌었다면 창을 다시 열어 주세요.",FORMATION_CHANGE_REQUIRED:"포메이션 변경 창에서 초과 선수 선택을 먼저 완료해 주세요.",SQUAD_INCOMPLETE:"벤치 선수를 제외한 모든 주전 선수를 배치해 주세요.",SQUAD_FULL:"스쿼드 11명을 모두 보유 중입니다. 선수를 매각한 뒤 매입해 주세요.",LEGACY_SQUAD_EXCESS:"기존 보유 선수가 정원을 초과했습니다. 초과 포지션 선수를 먼저 매각해 주세요.",AUTO_SQUAD_MANAGED:"스쿼드는 매입·매각에 따라 자동으로 반영됩니다.",TRADE_PLAYER_MISMATCH:"이 선수의 거래 내역만 첨부할 수 있습니다.",TITLE_REQUIRED:"제목을 2–80자로 입력해 주세요."};
 if(error.message&&squadMessages[error.message])throw new HttpError(409,squadMessages[error.message]);
 if(migrationMissing(error))throw new HttpError(503,"새 기능의 DB 연결을 준비하고 있습니다.");
 const key=Object.keys(messages).find(k=>error.message===k);
 if(key)throw new HttpError(key==="AUTH_REQUIRED"?401:key==="MEMBER_SUSPENDED"||key==="ADMIN_REQUIRED"||key==="NOT_AUTHOR"||key==="FAN_REQUIRED"?403:key==="POST_NOT_FOUND"?404:409,messages[key]);
 if(["23514","22P02","23502","23503"].includes(error.code??""))throw new HttpError(400,"입력 범위와 대상을 확인해 주세요.");
 throw new Error("DATABASE_OPERATION_FAILED");
}
export async function prototypeAvailable(db: SupabaseClient) {const r=await db.from("kickx_policy").select("version").limit(1);if(migrationMissing(r.error))return false;checkDatabase(r.error);return !!r.data?.length;}
export function asObject(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new HttpError(400,"입력 형식을 확인해 주세요.");return value as Record<string,unknown>;}
export function identity(value:unknown,uuid=false) {if(typeof value!=="string"||!(uuid?/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i:/^[a-zA-Z0-9_-]{1,100}$/).test(value))throw new HttpError(400,"ID를 확인해 주세요.");return value;}

/** Fail closed during rollout: settlement must not reach an older DB without match windows. */
export async function requireMatchTradingRules(db: SupabaseClient) {
 const result=await db.rpc("kickx_trade_windows",{p_players:[]});checkDatabase(result.error);
}
