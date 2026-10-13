import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http";
export const CATEGORIES=["자유","경기 분석","선수 토론","거래 후기","질문"];
export const FORMATIONS=["4-3-3","4-4-2","3-5-2","3-4-3","4-5-1"].map(id=>{const [d,m,f]=id.split('-').map(Number);return {id,name:id,positions:["GK",...Array(d).fill("DF"),...Array(m).fill("MF"),...Array(f).fill("FW")]};});
const messages: Record<string,string>={MEMBER_SUSPENDED:"이용 제한 중에는 거래·스쿼드·커뮤니티를 변경할 수 없습니다.",PROTECTED_ADMIN:"관리자 계정은 이 화면에서 이용 제한할 수 없습니다.",RULE_VERSION_MISMATCH:"계산 엔진과 정책 버전이 다릅니다. 운영 설정을 확인해 주세요.",AUTH_REQUIRED:"로그인해 주세요.",PROFILE_REQUIRED:"닉네임과 응원 구단을 먼저 설정해 주세요.",ADMIN_REQUIRED:"관리자 권한이 필요합니다.",PRICE_RECALCULATING:"새 가격 규칙으로 산정 중입니다. 잠시 후 다시 확인해 주세요.",PRICE_UNAVAILABLE:"아직 가치가 산정되지 않은 선수입니다.",TRADING_PAUSED:"거래가 중지된 선수입니다.",ALREADY_OWNED:"이미 보유한 선수입니다. 같은 선수는 한 명만 보유할 수 있습니다.",NOT_OWNED:"보유한 선수만 판매할 수 있습니다.",INSUFFICIENT_POINTS:"보유 포인트가 부족합니다.",QUOTE_EXPIRED:"견적이 만료되었습니다. 새 견적을 확인해 주세요.",PRICE_CHANGED:"가격이 변경되었습니다. 새 견적을 확인해 주세요.",QUOTE_NOT_FOUND:"견적을 찾을 수 없습니다.",REQUEST_REUSED:"이미 사용한 요청입니다. 새로고침해 주세요.",STALE_REVISION:"다른 창에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.",INVALID_SQUAD:"포메이션과 11개 자리를 확인해 주세요.",INVALID_SQUAD_PLAYER:"보유 여부와 포지션을 확인해 주세요.",DUPLICATE_PLAYER:"같은 선수를 중복 배치할 수 없습니다.",FAN_REQUIRED:"응원 구단 라운지에만 글과 댓글을 작성할 수 있습니다.",NOT_AUTHOR:"작성자만 수정하거나 삭제할 수 있습니다.",POST_NOT_FOUND:"게시글을 찾을 수 없습니다.",REPORT_NOT_FOUND:"신고를 찾을 수 없습니다.",TRADE_NOT_OWNED:"본인의 거래만 첨부할 수 있습니다.",TOO_FAST:"잠시 후 다시 작성해 주세요.",INVALID_TARGET:"대상을 확인해 주세요.",INVALID_PARENT:"답글 대상을 확인해 주세요.",INVALID_INPUT:"입력 내용을 확인해 주세요.",INVALID_ACTION:"지원하지 않는 요청입니다.",SOURCE_CHANGED:"원본이 변경되었습니다. 계산을 다시 실행해 주세요."};
export function migrationMissing(error: {code?:string;message?:string}|null) {return !!error && (["42P01","42883","PGRST202","PGRST205"].includes(error.code??""));}
export function checkDatabase(error:{code?:string;message?:string}|null) {
 if(!error)return;
 if(migrationMissing(error))throw new HttpError(503,"새 기능의 DB 연결을 준비하고 있습니다.");
 const key=Object.keys(messages).find(k=>error.message===k);
 if(key)throw new HttpError(key==="AUTH_REQUIRED"?401:key==="MEMBER_SUSPENDED"||key==="ADMIN_REQUIRED"||key==="NOT_AUTHOR"||key==="FAN_REQUIRED"?403:key==="POST_NOT_FOUND"?404:409,messages[key]);
 if(["23514","22P02","23502","23503"].includes(error.code??""))throw new HttpError(400,"입력 범위와 대상을 확인해 주세요.");
 throw new Error("DATABASE_OPERATION_FAILED");
}
export async function prototypeAvailable(db: SupabaseClient) {const r=await db.from("kickx_policy").select("version").limit(1);if(migrationMissing(r.error))return false;checkDatabase(r.error);return !!r.data?.length;}
export function asObject(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new HttpError(400,"입력 형식을 확인해 주세요.");return value as Record<string,unknown>;}
export function identity(value:unknown,uuid=false) {if(typeof value!=="string"||!(uuid?/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i:/^[a-zA-Z0-9_-]{1,100}$/).test(value))throw new HttpError(400,"ID를 확인해 주세요.");return value;}
