export type CatalogQuery = {
  page: number; size: number; q: string; league: string | null; team: string | null;
  position: string | null; sort: string; scope: string; day: string | null; state: string; month?: string | null;
};
export class CatalogInputError extends Error {}
const allowed = (value: string, values: string[], label: string) => {
  if (!values.includes(value)) throw new CatalogInputError(`${label} 값을 확인해 주세요.`);
  return value;
};
export function parseCatalogQuery(params: URLSearchParams, kind: "players" | "fixtures"): CatalogQuery {
  const integer = (key: string, fallback: number, max: number) => {
    const raw = params.get(key) ?? String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw new CatalogInputError(`${key} 범위를 확인해 주세요.`);
    return Number(raw);
  };
  const identity = (key: string) => {
    const v = params.get(key);
    if (!v || v === "all") return null;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(v)) throw new CatalogInputError(`${key} 값을 확인해 주세요.`);
    return v;
  };
  const q = (params.get("q") || "").normalize("NFC").trim();
  if (q.length > 100 || /[\x00-\x1f]/.test(q)) throw new CatalogInputError("검색어는 100자 이내로 입력해 주세요.");
  const day = params.get("day") || null;
  const month = params.get('month') || null;
  if (month && (kind !== 'fixtures' || !/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month) || !!day)) throw new CatalogInputError('연월을 확인해 주세요.');
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day)) throw new CatalogInputError("날짜를 확인해 주세요.");
  return {
    page: integer("page", 1, 10000), size: integer("size", kind === "players" ? 12 : 20, kind === 'fixtures' && month ? 500 : 50), q,
    league: identity("league"), team: identity("team"),
    position: params.has("position") ? allowed(params.get("position")!, ["GK","DF","MF","FW"], "포지션") : null,
    sort: allowed(params.get("sort") || "name", ["price","price-asc","change","performance","volume","name"], "정렬"),
    scope: allowed(params.get("scope") || "all", ["all","rising","falling","watch","owned"], "목록"),
    day, month, state: allowed(params.get("state") || "all", ["all","live","scheduled","finished","other"], "경기 상태"),
  };
}
export function literalLike(value: string) { return value.replace(/[\\%_]/g, "\\$&"); }
