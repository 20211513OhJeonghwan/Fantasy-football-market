import "server-only";
import { SQUAD_FORMATION } from "@/lib/kickx/squad";
/**
 * Development sample data (KICKX_MOCK_DATA=true).
 *
 * Every value below is illustrative. Prices, Performance, fees and rankings are NOT produced by
 * the KICK-X valuation engine — the UI shows an "예시 데이터" badge whenever this source is active.
 * Real players are used only so screens look realistic during design work.
 */
import type {
  AdminData,
  Comment,
  Fixture,
  Holding,
  League,
  MemberData,
  Player,
  PlayerRecord,
  Post,
  PublicData,
  RankingRow,
  Session,
  SeriesPoint,
  Team,
  Transaction,
} from "@/lib/kickx/types";

const DAY = 86_400_000;

/** Small deterministic PRNG so the sample set is stable between requests. */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const leagues: League[] = [
  { id: "epl", name: "프리미어리그" },
  { id: "laliga", name: "라리가" },
  { id: "seriea", name: "세리에 A" },
  { id: "bundesliga", name: "분데스리가" },
  { id: "ligue1", name: "리그 1" },
];

const team = (id: string, name: string, english: string, code: string, color: string, leagueId: string): Team => ({ id, name, english, code, color, leagueId });
const club = (id: string, name: string, english: string, leagueId: string): Team => ({ id, name, english, code: null, color: null, leagueId });
const teams: Team[] = [
  team("mci", "맨체스터 시티", "Manchester City", "MCI", "#6CABDD", "epl"),
  team("ars", "아스널", "Arsenal", "ARS", "#EF0107", "epl"),
  team("liv", "리버풀", "Liverpool", "LIV", "#C8102E", "epl"),
  team("tot", "토트넘", "Tottenham Hotspur", "TOT", "#132257", "epl"),
  team("rma", "레알 마드리드", "Real Madrid", "RMA", "#1E3A8A", "laliga"),
  team("fcb", "바르셀로나", "FC Barcelona", "BAR", "#A50044", "laliga"),
  team("atm", "아틀레티코 마드리드", "Atlético Madrid", "ATM", "#CB3524", "laliga"),
  team("rso", "레알 소시에다드", "Real Sociedad", "RSO", "#0067B1", "laliga"),
  team("int", "인테르", "Inter", "INT", "#0068A8", "seriea"),
  team("mil", "AC 밀란", "AC Milan", "MIL", "#FB090B", "seriea"),
  team("juv", "유벤투스", "Juventus", "JUV", "#111111", "seriea"),
  team("nap", "나폴리", "Napoli", "NAP", "#12A0D7", "seriea"),
  team("bay", "바이에른 뮌헨", "FC Bayern München", "FCB", "#DC052D", "bundesliga"),
  team("bvb", "보루시아 도르트문트", "Borussia Dortmund", "BVB", "#E8C400", "bundesliga"),
  team("b04", "레버쿠젠", "Bayer Leverkusen", "B04", "#E32221", "bundesliga"),
  team("rbl", "라이프치히", "RB Leipzig", "RBL", "#DD0741", "bundesliga"),
  team("psg", "파리 생제르맹", "Paris Saint-Germain", "PSG", "#004170", "ligue1"),
  team("om", "마르세유", "Olympique de Marseille", "OM", "#2FAEE0", "ligue1"),
  team("asm", "AS 모나코", "AS Monaco", "ASM", "#E51B22", "ligue1"),
  team("ol", "리옹", "Olympique Lyonnais", "OL", "#1D2D5C", "ligue1"),
  // Rest of the current big-five line-up (EPL 20 · LaLiga 20 · Serie A 20 · Bundesliga 18 · Ligue 1 18).
  // Code/colour left empty like real BSD rows, so the UI derives crests from club identity.
  club("che", "첼시", "Chelsea", "epl"),
  club("cry", "크리스털 팰리스", "Crystal Palace", "epl"),
  club("nfo", "노팅엄 포리스트", "Nottingham Forest", "epl"),
  club("bre", "브렌트퍼드", "Brentford", "epl"),
  club("mun", "맨체스터 유나이티드", "Manchester United", "epl"),
  club("lee", "리즈 유나이티드", "Leeds United", "epl"),
  club("bou", "본머스", "Bournemouth", "epl"),
  club("eve", "에버턴", "Everton", "epl"),
  club("cov", "코번트리 시티", "Coventry City", "epl"),
  club("hul", "헐 시티", "Hull City", "epl"),
  club("avl", "애스턴 빌라", "Aston Villa", "epl"),
  club("new", "뉴캐슬 유나이티드", "Newcastle United", "epl"),
  club("bha", "브라이턴", "Brighton & Hove Albion", "epl"),
  club("ful", "풀럼", "Fulham", "epl"),
  club("sun", "선덜랜드", "Sunderland", "epl"),
  club("ips", "입스위치 타운", "Ipswich Town", "epl"),
  club("mal", "말라가", "Málaga CF", "laliga"),
  club("dep", "데포르티보 라코루냐", "Deportivo de A Coruña", "laliga"),
  club("rac", "라싱 산탄데르", "Real Racing Club", "laliga"),
  club("ray", "라요 바예카노", "Rayo Vallecano", "laliga"),
  club("vil", "비야레알", "Villarreal", "laliga"),
  club("ala", "알라베스", "Deportivo Alavés", "laliga"),
  club("lev", "레반테", "Levante UD", "laliga"),
  club("val", "발렌시아", "Valencia", "laliga"),
  club("cel", "셀타 비고", "Celta Vigo", "laliga"),
  club("get", "헤타페", "Getafe", "laliga"),
  club("ath", "아틀레틱 클루브", "Athletic Club", "laliga"),
  club("sev", "세비야", "Sevilla", "laliga"),
  club("esp", "에스파뇰", "Espanyol", "laliga"),
  club("elc", "엘체", "Elche", "laliga"),
  club("bet", "레알 베티스", "Real Betis", "laliga"),
  club("osa", "오사수나", "Osasuna", "laliga"),
  club("fro", "프로시노네", "Frosinone", "seriea"),
  club("ven", "베네치아", "Venezia", "seriea"),
  club("mon", "몬차", "Monza", "seriea"),
  club("gen", "제노아", "Genoa", "seriea"),
  club("lec", "레체", "Lecce", "seriea"),
  club("sas", "사수올로", "Sassuolo", "seriea"),
  club("rom", "AS 로마", "AS Roma", "seriea"),
  club("bol", "볼로냐", "Bologna", "seriea"),
  club("cag", "칼리아리", "Cagliari", "seriea"),
  club("fio", "피오렌티나", "Fiorentina", "seriea"),
  club("com", "코모", "Como", "seriea"),
  club("laz", "라치오", "Lazio", "seriea"),
  club("ata", "아탈란타", "Atalanta", "seriea"),
  club("par", "파르마", "Parma", "seriea"),
  club("udi", "우디네세", "Udinese", "seriea"),
  club("tor", "토리노", "Torino", "seriea"),
  club("s04", "샬케 04", "FC Schalke 04", "bundesliga"),
  club("scp", "파더보른", "SC Paderborn 07", "bundesliga"),
  club("sve", "엘버스베르크", "SV 07 Elversberg", "bundesliga"),
  club("fcu", "우니온 베를린", "1. FC Union Berlin", "bundesliga"),
  club("vfb", "슈투트가르트", "VfB Stuttgart", "bundesliga"),
  club("tsg", "호펜하임", "TSG Hoffenheim", "bundesliga"),
  club("sge", "프랑크푸르트", "Eintracht Frankfurt", "bundesliga"),
  club("svw", "베르더 브레멘", "SV Werder Bremen", "bundesliga"),
  club("scf", "프라이부르크", "SC Freiburg", "bundesliga"),
  club("fca", "아우크스부르크", "FC Augsburg", "bundesliga"),
  club("m05", "마인츠", "1. FSV Mainz 05", "bundesliga"),
  club("koe", "쾰른", "1. FC Köln", "bundesliga"),
  club("bmg", "묀헨글라트바흐", "Borussia M'gladbach", "bundesliga"),
  club("hsv", "함부르크", "Hamburger SV", "bundesliga"),
  club("hac", "르아브르", "Le Havre", "ligue1"),
  club("nic", "니스", "Nice", "ligue1"),
  club("tfc", "툴루즈", "Toulouse", "ligue1"),
  club("b29", "브레스트", "Stade Brestois", "ligue1"),
  club("lil", "릴", "Lille", "ligue1"),
  club("sco", "앙제", "Angers", "ligue1"),
  club("pfc", "파리 FC", "Paris FC", "ligue1"),
  club("aja", "오세르", "Auxerre", "ligue1"),
  club("fcl", "로리앙", "Lorient", "ligue1"),
  club("rcs", "스트라스부르", "RC Strasbourg", "ligue1"),
  club("tro", "트루아", "Troyes", "ligue1"),
  club("lem", "르망", "Le Mans", "ligue1"),
  club("srf", "렌", "Stade Rennais", "ligue1"),
  club("rcl", "랑스", "RC Lens", "ligue1"),
];

type Seed = [id: string, name: string, english: string, short: string, team: string, position: Player["position"], country: string, age: number, price: number, change: number, performance: number];
const seeds: Seed[] = [
  ["haaland", "엘링 홀란", "Erling Haaland", "홀란", "mci", "FW", "노르웨이", 26, 168_400, 6.4, 91],
  ["rodri", "로드리", "Rodri", "로드리", "mci", "MF", "스페인", 30, 121_300, -1.2, 78],
  ["foden", "필 포든", "Phil Foden", "포든", "mci", "MF", "잉글랜드", 26, 104_800, 2.1, 74],
  ["dias", "후벵 디아스", "Rúben Dias", "디아스", "mci", "DF", "포르투갈", 29, 82_600, 0.4, 71],
  ["saka", "부카요 사카", "Bukayo Saka", "사카", "ars", "FW", "잉글랜드", 25, 142_900, 8.7, 88],
  ["odegaard", "마르틴 외데고르", "Martin Ødegaard", "외데고르", "ars", "MF", "노르웨이", 27, 109_500, -2.8, 69],
  ["rice", "데클란 라이스", "Declan Rice", "라이스", "ars", "MF", "잉글랜드", 27, 116_200, 3.3, 82],
  ["saliba", "윌리엄 살리바", "William Saliba", "살리바", "ars", "DF", "프랑스", 25, 96_700, 1.9, 80],
  ["raya", "다비드 라야", "David Raya", "라야", "ars", "GK", "스페인", 30, 54_300, 0.8, 76],
  ["salah", "모하메드 살라", "Mohamed Salah", "살라", "liv", "FW", "이집트", 34, 118_600, -4.6, 72],
  ["wirtz", "플로리안 비르츠", "Florian Wirtz", "비르츠", "liv", "MF", "독일", 23, 131_800, 11.2, 90],
  ["vandijk", "버질 반 다이크", "Virgil van Dijk", "반 다이크", "liv", "DF", "네덜란드", 35, 71_400, -0.6, 77],
  ["alisson", "알리송", "Alisson Becker", "알리송", "liv", "GK", "브라질", 33, 49_800, 0, 70],
  ["maddison", "제임스 매디슨", "James Maddison", "매디슨", "tot", "MF", "잉글랜드", 29, 63_900, -3.1, 61],
  ["vandeven", "미키 반 더 벤", "Micky van de Ven", "반 더 벤", "tot", "DF", "네덜란드", 25, 68_200, 4.4, 79],
  ["vicario", "굴리엘모 비카리오", "Guglielmo Vicario", "비카리오", "tot", "GK", "이탈리아", 29, 38_400, -1.9, 63],
  ["mbappe", "킬리안 음바페", "Kylian Mbappé", "음바페", "rma", "FW", "프랑스", 27, 178_200, 4.9, 93],
  ["vinicius", "비니시우스 주니오르", "Vinícius Júnior", "비니시우스", "rma", "FW", "브라질", 26, 151_700, -5.4, 75],
  ["bellingham", "주드 벨링엄", "Jude Bellingham", "벨링엄", "rma", "MF", "잉글랜드", 23, 158_900, 2.6, 86],
  ["valverde", "페데리코 발베르데", "Federico Valverde", "발베르데", "rma", "MF", "우루과이", 28, 112_400, 1.1, 79],
  ["courtois", "티보 쿠르투아", "Thibaut Courtois", "쿠르투아", "rma", "GK", "벨기에", 34, 52_600, 2.4, 84],
  ["yamal", "라민 야말", "Lamine Yamal", "야말", "fcb", "FW", "스페인", 19, 172_300, 9.8, 92],
  ["pedri", "페드리", "Pedri", "페드리", "fcb", "MF", "스페인", 23, 127_500, 3.7, 85],
  ["raphinha", "하피냐", "Raphinha", "하피냐", "fcb", "FW", "브라질", 29, 109_900, -2.2, 73],
  ["kounde", "쥘 쿤데", "Jules Koundé", "쿤데", "fcb", "DF", "프랑스", 27, 74_800, 0.9, 74],
  ["griezmann", "앙투안 그리즈만", "Antoine Griezmann", "그리즈만", "atm", "FW", "프랑스", 35, 58_700, -6.8, 64],
  ["oblak", "얀 오블락", "Jan Oblak", "오블락", "atm", "GK", "슬로베니아", 33, 41_900, 1.6, 78],
  ["oyarzabal", "미켈 오야르사발", "Mikel Oyarzabal", "오야르사발", "rso", "FW", "스페인", 29, 61_300, 5.2, 77],
  ["lautaro", "라우타로 마르티네스", "Lautaro Martínez", "라우타로", "int", "FW", "아르헨티나", 29, 124_100, 3.0, 83],
  ["barella", "니콜로 바렐라", "Nicolò Barella", "바렐라", "int", "MF", "이탈리아", 29, 92_800, -0.8, 72],
  ["bastoni", "알레산드로 바스토니", "Alessandro Bastoni", "바스토니", "int", "DF", "이탈리아", 27, 84_300, 2.7, 81],
  ["pulisic", "크리스천 풀리식", "Christian Pulisic", "풀리식", "mil", "FW", "미국", 28, 79_600, 6.1, 80],
  ["maignan", "마이크 메냥", "Mike Maignan", "메냥", "mil", "GK", "프랑스", 31, 47_200, -2.5, 66],
  ["vlahovic", "두산 블라호비치", "Dušan Vlahović", "블라호비치", "juv", "FW", "세르비아", 26, 71_800, -7.4, 58],
  ["bremer", "브레메르", "Gleison Bremer", "브레메르", "juv", "DF", "브라질", 29, 66_500, 0.3, 73],
  ["mctominay", "스콧 맥토미니", "Scott McTominay", "맥토미니", "nap", "MF", "스코틀랜드", 29, 77_900, 4.0, 81],
  ["kane", "해리 케인", "Harry Kane", "케인", "bay", "FW", "잉글랜드", 33, 146_500, 5.6, 89],
  ["musiala", "자말 무시알라", "Jamal Musiala", "무시알라", "bay", "MF", "독일", 23, 149_200, 7.3, 87],
  ["kimminjae", "김민재", "Kim Min-jae", "김민재", "bay", "DF", "대한민국", 29, 78_300, 3.8, 82],
  ["kimmich", "요주아 키미히", "Joshua Kimmich", "키미히", "bay", "MF", "독일", 31, 98_100, -1.4, 76],
  ["kobel", "그레고어 코벨", "Gregor Kobel", "코벨", "bvb", "GK", "스위스", 28, 45_600, 2.9, 79],
  ["brandt", "율리안 브란트", "Julian Brandt", "브란트", "bvb", "MF", "독일", 30, 58_400, -3.6, 62],
  ["grimaldo", "알레한드로 그리말도", "Alejandro Grimaldo", "그리말도", "b04", "DF", "스페인", 31, 61_700, 1.4, 75],
  ["dembele", "우스만 뎀벨레", "Ousmane Dembélé", "뎀벨레", "psg", "FW", "프랑스", 29, 139_600, 2.0, 84],
  ["leekangin", "이강인", "Lee Kang-in", "이강인", "psg", "MF", "대한민국", 25, 72_900, 10.4, 83],
  ["vitinha", "비티냐", "Vitinha", "비티냐", "psg", "MF", "포르투갈", 26, 106_300, 1.8, 82],
  ["hakimi", "아슈라프 하키미", "Achraf Hakimi", "하키미", "psg", "DF", "모로코", 27, 91_400, -0.9, 78],
];

function history(id: string, price: number, change: number, now: number): SeriesPoint[] {
  const random = seeded(id);
  const points: SeriesPoint[] = [];
  // Walk backwards from today's value so the last step matches the displayed change.
  let value = price;
  for (let d = 0; d < 30; d++) {
    points.unshift({ at: new Date(now - d * DAY).toISOString(), value: Math.round(value) });
    const step = d === 0 ? change / 100 : (random() - 0.48) * 0.045;
    value = value / (1 + step);
  }
  return points;
}

function records(id: string, teamId: string, performance: number, position: Player["position"], now: number): PlayerRecord[] {
  const random = seeded(id + "-records");
  const opponents = teams.filter(t => t.id !== teamId);
  return Array.from({ length: 6 }, (_, i) => {
    const opponent = opponents[Math.floor(random() * opponents.length)];
    const scored = Math.floor(random() * 4), conceded = Math.floor(random() * 3);
    const attacking = position === "FW" ? 0.45 : position === "MF" ? 0.22 : 0.05;
    const minutes = random() > 0.15 ? 90 - Math.floor(random() * 3) * 15 : 0;
    return {
      id: `${id}-r${i}`,
      fixtureId: `${id}-r${i}`,
      leagueId: teams.find(t => t.id === teamId)?.leagueId ?? null,
      playedAt: new Date(now - (i * 6 + 2) * DAY).toISOString(),
      opponent: opponent.name,
      result: `${scored}–${conceded} ${scored > conceded ? "승" : scored === conceded ? "무" : "패"}`,
      minutes,
      goals: minutes ? (random() < attacking ? 1 + (random() < 0.2 ? 1 : 0) : 0) : 0,
      assists: minutes ? (random() < attacking * 0.7 ? 1 : 0) : 0,
      performance: minutes ? Math.max(35, Math.min(99, Math.round(performance + (random() - 0.5) * 22))) : null,
    };
  });
}

/** Example score breakdowns for the detail screen (mock only; real ones come from the stored engine results). */
const GOAL_POINTS = { GK: 10, DF: 6, MF: 5, FW: 4 }, ASSIST_POINTS = { GK: 5, DF: 4, MF: 3, FW: 3 };
function scoreDetails(position: Player["position"], records_: Player["records"]): Player["scoreDetails"] {
  const pos = position ?? "MF";
  return records_.map((r, i) => {
    if (!r.minutes) return { fixture_id: r.id, score: null, status: "not-played", rule_version: "prototype-v1", breakdown: [], warnings: ["NO_PRICE_CHANGE_FOR_NON_PARTICIPATION"] };
    if (i === 3) return { fixture_id: r.id, score: null, status: "blocked", rule_version: "prototype-v1", breakdown: [], warnings: ["CONFIRMED_LINEUP_REQUIRED"] };
    const breakdown = [
      { metric: "minutes", value: r.minutes, points: r.minutes >= 60 ? 2 : 1, evidence: "example" },
      ...(r.goals ? [{ metric: "goals", value: r.goals, points: r.goals * GOAL_POINTS[pos], evidence: "example" }] : []),
      ...(r.assists ? [{ metric: "assists", value: r.assists, points: r.assists * ASSIST_POINTS[pos], evidence: "example" }] : []),
      ...(i === 1 ? [{ metric: "yellow_cards", value: 1, points: -1, evidence: "example" }] : []),
    ];
    return { fixture_id: r.id, score: breakdown.reduce((sum, b) => sum + b.points, 0), status: "provisional", rule_version: "prototype-v1", breakdown, warnings: ["key_passes:UNVERIFIED_OR_MISSING_EXCLUDED", "PROTOTYPE_INCIDENT_COMPLETENESS_ASSUMPTION"] };
  });
}

function players(now: number): Player[] {
  return seeds.map(([id, name, english, short, teamId, position, country, age, price, change, seedPerformance]) => {
    const random = seeded(id + "-season");
    const records_ = records(id, teamId, seedPerformance, position, now);
    // Raw prototype scores (not 0–100): each record shows the same score as its example breakdown.
    const details = scoreDetails(position, records_) ?? [];
    records_.forEach((r) => { r.performance = details.find((d) => d.fixture_id === r.id)?.score ?? null; });
    const performance = records_.find((r) => r.performance != null)?.performance ?? null;
    const apps = 9 + Math.floor(random() * 4);
    const goalsRate = position === "FW" ? 0.7 : position === "MF" ? 0.25 : 0.05;
    return {
      id, name, english, short, team: teamId, position, country, age, price, change, performance,
      volume: Math.round(200 + random() * 2600),
      goals: Math.round(apps * goalsRate * (0.6 + random() * 0.8)),
      assists: Math.round(apps * goalsRate * 0.6 * (0.5 + random())),
      minutes: apps * 80 + Math.floor(random() * 90),
      history: history(id, price, change, now),
      records: records_,
      scoreDetails: details,
      analysis: `${name}의 최근 6경기 평균 Performance는 ${(records_.reduce((s, r) => s + (r.performance ?? 0), 0) / Math.max(1, records_.filter(r => r.performance != null).length)).toFixed(1)}점입니다. 최근 가치 변동은 ${change > 0 ? "+" : ""}${change.toFixed(1)}%로, ${change >= 3 ? "경기력 상승이 가치에 빠르게 반영되고 있습니다." : change <= -3 ? "출전 시간과 공격 포인트 감소가 가치 하락으로 이어졌습니다." : "경기력과 가치가 안정적으로 유지되고 있습니다."} (예시 분석 문장입니다.)`,
      updatedAt: new Date(now - 2 * 3_600_000).toISOString(),
      status: id === "griezmann" ? "거래 일시 중지" : null,
      photo: null,
    };
  });
}

const formations = [SQUAD_FORMATION];

function fixtures(now: number): Fixture[] {
  const pairs: [string, string, number, string, number | null, number | null][] = [
    ["ars", "liv", -6, "FT", 2, 1], ["rma", "atm", -5, "FT", 3, 1], ["bay", "bvb", -4, "FT", 4, 2],
    ["int", "juv", -3, "FT", 1, 1], ["psg", "om", -2, "FT", 2, 0], ["fcb", "rso", -1, "FT", 3, 0],
    ["mci", "tot", 0, "2H", 2, 0], ["mil", "nap", 0.2, "NS", null, null], ["b04", "rbl", 1, "NS", null, null],
    ["liv", "mci", 2, "NS", null, null], ["asm", "ol", 3, "NS", null, null], ["tot", "ars", 5, "NS", null, null],
  ];
  return pairs.map(([home, away, offset, status, homeScore, awayScore], i) => {
    const kickoff = new Date(now + offset * DAY);
    kickoff.setUTCHours(offset === 0 ? kickoff.getUTCHours() - 1 : 19, 0, 0, 0);
    return {
      id: `fx-${i}`, leagueId: teams.find(t => t.id === home)?.leagueId ?? null,
      home, away, startsAt: kickoff.toISOString(), status, homeScore, awayScore,
      // Example scoring states for finished/live matches (mock only).
      reflectionStatus: status === "FT" ? (["reflected", "partial", "withheld", "pending"] as const)[i % 4] : status === "NS" ? null : "pending",
    };
  });
}

const authors = ["노스런던레드", "하이프레스", "가짜9번", "인버티드풀백", "중원사령관", "역습한방", "클린시트", "박스투박스"];

function posts(now: number): { posts: Post[]; comments: Comment[] } {
  const items: [Post["scope"], string, string, string, number][] = [
    ["club", "ars", "리버풀전 2-1, 하프스페이스 공략이 완벽했다", "전반 30분 이후 사카–외데고르 라인이 오른쪽 하프스페이스를 계속 열어줬습니다. 라이스의 전진 패스 비중도 눈에 띄게 늘었고요. 후반 교체 타이밍만 조금 빨랐으면 더 편하게 이겼을 경기.", 4],
    ["club", "ars", "사카 지금 들어가도 늦지 않았을까요?", "최근 일주일 +8% 넘게 올랐는데 다음 일정이 토트넘 원정입니다. 이미 보유 중인 분들은 어떻게 하실 계획인지 궁금합니다.", 9],
    ["club", "rma", "더비 3-1, 벨링엄 중원 장악력 미쳤다", "볼 회수 9회에 키패스 3회. 음바페 골보다 벨링엄의 압박 전환이 승부를 갈랐다고 봅니다.", 14],
    ["club", "bay", "김민재 최근 5경기 수비 지표 정리", "경합 성공률 71%, 인터셉트 경기당 2.4회. 빌드업 관여도 늘면서 Performance가 꾸준히 80점대를 유지 중입니다.", 20],
    ["club", "psg", "이강인 오른쪽 하프스페이스 기용 계속 갔으면", "중앙에서 받을 때보다 측면에서 안으로 좁혀 들어올 때 결정적인 패스가 훨씬 많이 나오네요.", 26],
    ["club", "liv", "비르츠 +11%… 고점일까 시작일까", "적응 기간 끝나고 경기력이 올라온 게 숫자로 보입니다. 저는 절반만 익절하고 나머지는 홀드합니다.", 31],
    ["player", "yamal", "야말, 이번 시즌 드리블 성공률 리그 1위", "볼을 잡은 뒤 첫 터치 방향이 정말 다양합니다. 가격이 비싸도 장기 보유 가치가 있다고 봐요.", 3],
    ["player", "haaland", "홀란 16만 돌파, 지금 매각할 타이밍?", "다음 3경기가 상위권 팀 연전이라 고민됩니다. 거래 내역 첨부합니다.", 7],
    ["player", "leekangin", "이강인 2경기 연속 공격 포인트 🎯", "마르세유전 도움 장면, 수비 세 명 사이로 찔러준 패스가 압권이었습니다.", 11],
    ["player", "kimminjae", "김민재 라운지 처음 왔습니다", "보유 선수 중 가장 꾸준한 선수라 애정이 갑니다. 다들 언제 영입하셨나요?", 16],
    ["player", "saka", "사카 xG 대비 득점 효율 정리", "기대득점 대비 실제 득점이 +2.1로 높은 편입니다. 단기 반등보다는 꾸준함이 강점.", 22],
    ["player", "mbappe", "음바페 해트트릭 이후 가치 반응", "해트트릭 다음 날 +4.9%. 이미 높은 가격대라 변동폭은 생각보다 작네요.", 40],
  ];
  const result: Post[] = items.map(([scope, target, title, body, hoursAgo], i) => ({
    id: `post-${i + 1}`, author: authors[i % authors.length], authorId: `user-${i % authors.length}`,
    scope, target, title, body, date: new Date(now - hoursAgo * 3_600_000).toISOString(),
    likes: [42, 18, 77, 35, 24, 51, 63, 29, 88, 12, 19, 46][i], views: [612, 284, 1203, 498, 356, 731, 940, 402, 1388, 166, 271, 702][i],
    commentCount: [3, 2, 5, 1, 2, 4, 3, 2, 6, 1, 1, 3][i], transaction: null,
  }));
  result[7].transaction = { id: "attached-1", playerId: "haaland", playerName: "엘링 홀란", type: "buy", quantity: 1, price: 142_100, fee: 0, net: 142_100, date: new Date(now - 18 * DAY).toISOString(), status: "체결" };
  const comments: Comment[] = [
    { id: "c1", postId: "post-1", author: "하이프레스", authorId: "user-1", body: "라이스 전진 패스 진짜 좋았어요. 이 흐름이면 다음 경기도 기대됩니다.", date: new Date(now - 3 * 3_600_000).toISOString() },
    { id: "c2", postId: "post-1", author: "클린시트", authorId: "user-6", body: "살리바 커버 범위도 칭찬해야 합니다.", date: new Date(now - 2 * 3_600_000).toISOString() },
    { id: "c3", postId: "post-1", author: "데모 매니저", authorId: "demo-user", body: "사카 보유 중인데 이번 주 상승분 그대로 가져갑니다.", date: new Date(now - 1 * 3_600_000).toISOString() },
    { id: "c4", postId: "post-8", author: "역습한방", authorId: "user-5", body: "저는 일정 끝날 때까지 홀드합니다.", date: new Date(now - 5 * 3_600_000).toISOString() },
  ];
  return { posts: result, comments };
}

function rankings(now: number, demo: MemberData) {
  const names = ["오프사이드트랩", "하이프레스", "노스런던레드", "중원사령관", "토탈풋볼", "가짜9번", "데모 매니저", "박스투박스", "인버티드풀백", "클린시트", "역습한방", "카테나치오", "티키타카", "게겐프레싱", "제로톱", "윙백러버"];
  const clubs = ["mci", "rma", "ars", "bay", "fcb", "liv", "ars", "psg", "int", "bvb", "tot", "juv", "fcb", "liv", "mil", "nap"];
  const make = (id: "weekly" | "monthly", scale: number) => {
    const rows: RankingRow[] = names.map((nickname, i) => ({
      userId: nickname === "데모 매니저" ? "demo-user" : `rank-${i}`, rank: i + 1, nickname, team: clubs[i],
      returnRate: nickname === "데모 매니저" ? (id === "weekly" ? 9.6 : demo.returnRate) : Number((scale * (14.8 - i * 0.93)).toFixed(1)),
      assets: nickname === "데모 매니저" ? demo.totalAssets : Math.round(1_300_000 * (1 + (2.6 * (14.8 - i * 0.93)) / 100)),
    }));
    rows.sort((a, b) => (b.returnRate ?? 0) - (a.returnRate ?? 0)).forEach((row, i) => { row.rank = i + 1; });
    return { id, startsAt: new Date(now - (id === "weekly" ? 7 : 30) * DAY).toISOString(), endsAt: new Date(now).toISOString(), calculatedAt: new Date(now - 3_600_000).toISOString(), rows };
  };
  return [make("weekly", 1), make("monthly", 2.6)];
}

const demoSquad: Record<string, string[]> = {
  // Holdings respect the fixed 4-3-3 position capacities.
  GK: ["raya"], DF: ["saliba", "kimminjae", "vandeven", "bastoni"], MF: ["rice", "leekangin", "musiala"], FW: ["saka", "haaland", "yamal"],
};
const bench: string[] = [];

function member(list: Player[], now: number): MemberData {
  const random = seeded("demo-member");
  const owned = [...Object.values(demoSquad).flat(), ...bench];
  const holdings: Holding[] = owned.map((playerId, i) => {
    const p = list.find(item => item.id === playerId)!;
    const value = p.price ?? 0;
    const cost = Math.round(value / (1 + (random() * 0.34 - 0.1)));
    return { id: `h-${i}`, playerId, playerName: p.name, quantity: 1, cost, value, profit: value - cost, returnRate: Number((((value - cost) / cost) * 100).toFixed(1)) };
  });
  const playerAssets = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  const points = 214_600;
  const initial = 1_300_000; // Illustrative starting balance; the real amount is undecided.
  const totalAssets = playerAssets + points;
  const transactions: Transaction[] = holdings.map((h, i) => ({
    id: `tx-b${i}`, playerId: h.playerId, playerName: h.playerName, type: "buy" as const, quantity: 1, price: h.cost, fee: 0, net: h.cost,
    date: new Date(now - (24 - i * 1.6) * DAY).toISOString(), status: "체결",
  }));
  for (const [i, [playerId, price]] of ([["salah", 124_300], ["vlahovic", 79_200], ["griezmann", 66_100]] as const).entries()) {
    const p = list.find(item => item.id === playerId)!;
    const fee = Math.round(price * 0.02);
    transactions.push({ id: `tx-s${i}`, playerId, playerName: p.name, type: "sell", quantity: 1, price, fee, net: price - fee, date: new Date(now - (3 + i * 4) * DAY).toISOString(), status: "체결" });
  }
  transactions.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const assetHistory: SeriesPoint[] = [];
  let value = totalAssets;
  for (let d = 0; d < 30; d++) {
    assetHistory.unshift({ at: new Date(now - d * DAY).toISOString(), value: Math.round(value) });
    value = value / (1 + (random() - 0.42) * 0.018);
  }
  const formation = formations[0];
  const pool = { ...demoSquad, GK: [...demoSquad.GK], DF: [...demoSquad.DF], MF: [...demoSquad.MF], FW: [...demoSquad.FW] };
  const slots = formation.positions.map(pos => pool[pos].shift() ?? null);
  const squadPlayers = slots.map(id => list.find(p => p.id === id)).filter(Boolean) as Player[];
  return {
    financialReady: true, points, totalAssets, playerAssets,
    profit: holdings.reduce((s, h) => s + (h.profit ?? 0), 0),
    returnRate: Number((((totalAssets - initial) / initial) * 100).toFixed(1)),
    weeklyRank: 7, holdings, transactions,
    watchlist: ["yamal", "wirtz", "mbappe", "kane", "pedri", "leekangin"],
    assetHistory,
    squad: {
      formationId: formation.id, slots,
      value: squadPlayers.reduce((s, p) => s + (p.price ?? 0), 0),
      performance: Math.round(squadPlayers.reduce((s, p) => s + (p.performance ?? 0), 0) / squadPlayers.length * 10) / 10,
    },
  };
}

export function mockPublicData(now = Date.now()): PublicData {
  const list = players(now);
  const { posts: postList, comments } = posts(now);
  const demo = member(list, now);
  return {
    players: list, teams, leagues, fixtures: fixtures(now), formations, posts: postList, comments,
    rankings: rankings(now, demo),
    market: {
      volume: list.reduce((s, p) => s + (p.volume ?? 0), 0),
      rising: list.filter(p => (p.change ?? 0) > 0).length,
      falling: list.filter(p => (p.change ?? 0) < 0).length,
      calculatedAt: new Date(now - 3_600_000).toISOString(),
    },
    updatedAt: new Date(now - 2 * 3_600_000).toISOString(),
  };
}
export const mockSession: Session = { userId: "demo-user", role: "admin", profile: { nickname: "데모 매니저", team: "ars" } };
export function mockMemberData(now = Date.now()): MemberData {
  return member(players(now), now);
}

/** Illustrative operations data for the admin screens (sample only). */
export function mockAdminData(now = Date.now()): AdminData {
  const hour = 3_600_000;
  const jobs: AdminData["jobs"] = [
    { id: "job-2410", name: "경기 데이터 수집", kind: "collect", target: "프리미어리그 · 맨체스터 시티 vs 토트넘", time: new Date(now - 0.3 * hour).toISOString(), status: "진행 중", success: 14, fail: 0, error: null },
    { id: "job-2409", name: "선수 가치 갱신", kind: "value", target: "라리가 10라운드 · 38명", time: new Date(now - 2 * hour).toISOString(), status: "완료", success: 38, fail: 0, error: null },
    { id: "job-2408", name: "Performance 계산", kind: "performance", target: "라리가 10라운드 · 38명", time: new Date(now - 2.4 * hour).toISOString(), status: "완료", success: 38, fail: 0, error: null },
    { id: "job-2407", name: "경기 데이터 수집", kind: "collect", target: "리그 1 · 파리 생제르맹 vs 마르세유", time: new Date(now - 26 * hour).toISOString(), status: "실패", success: 21, fail: 3, error: "BSD 응답 지연(timeout 20s) · fixture 1204517 선수 기록 3건 누락. 재처리 대기 중." },
    { id: "job-2406", name: "Performance 계산", kind: "performance", target: "세리에 A 9라운드 · 41명", time: new Date(now - 49 * hour).toISOString(), status: "완료", success: 41, fail: 0, error: null },
    { id: "job-2405", name: "선수 가치 갱신", kind: "value", target: "세리에 A 9라운드 · 41명", time: new Date(now - 48.5 * hour).toISOString(), status: "완료", success: 41, fail: 0, error: null },
    { id: "job-2404", name: "경기 데이터 수집", kind: "collect", target: "분데스리가 · 바이에른 뮌헨 vs 도르트문트", time: new Date(now - 74 * hour).toISOString(), status: "완료", success: 28, fail: 0, error: null },
  ];
  const users = ["user-1", "user-4", "demo-user", "user-7", "user-2", "user-5"];
  const picks: [string, string, "buy" | "sell", number][] = [
    ["yamal", "라민 야말", "buy", 172_300], ["haaland", "엘링 홀란", "sell", 168_400], ["wirtz", "플로리안 비르츠", "buy", 131_800],
    ["vlahovic", "두산 블라호비치", "sell", 71_800], ["leekangin", "이강인", "buy", 72_900], ["mbappe", "킬리안 음바페", "buy", 178_200],
    ["salah", "모하메드 살라", "sell", 118_600], ["kimminjae", "김민재", "buy", 78_300],
  ];
  const trades: AdminData["trades"] = picks.map(([playerId, playerName, type, price], i) => {
    const fee = type === "sell" ? Math.round(price * 0.02) : 0;
    return { id: `TX-${9120 - i}`, userId: users[i % users.length], playerId, playerName, type, quantity: 1, price, fee, net: type === "sell" ? price - fee : price, date: new Date(now - (i * 2.7 + 0.2) * hour).toISOString(), status: "체결" };
  });
  const reports: AdminData["reports"] = [
    { id: "rp-31", postId: "post-2", title: "사카 지금 들어가도 늦지 않았을까요?", reason: "근거 없는 가격 선동 의심", status: "접수", date: new Date(now - 1.5 * hour).toISOString() },
    { id: "rp-30", postId: "post-6", title: "비르츠 +11%… 고점일까 시작일까", reason: "도배성 게시글", status: "접수", date: new Date(now - 5 * hour).toISOString() },
    { id: "rp-29", postId: "post-3", title: "더비 3-1, 벨링엄 중원 장악력 미쳤다", reason: "상대 팬 비하 표현", status: "숨김", date: new Date(now - 30 * hour).toISOString() },
    { id: "rp-28", postId: "post-9", title: "이강인 2경기 연속 공격 포인트", reason: "광고성 링크", status: "기각", date: new Date(now - 52 * hour).toISOString() },
  ];
  const audit: AdminData["audit"] = [
    { id: "au-5", description: "job-2407 재처리 예약 (운영자 admin-01)", date: new Date(now - 20 * hour).toISOString() },
    { id: "au-4", description: "신고 rp-29 게시글 숨김 처리", date: new Date(now - 29 * hour).toISOString() },
    { id: "au-3", description: "신고 rp-28 기각 처리", date: new Date(now - 50 * hour).toISOString() },
    { id: "au-2", description: "세리에 A 9라운드 가치 갱신 승인", date: new Date(now - 48 * hour).toISOString() },
  ];
  return {
    summary: { players: seeds.length, completedJobs: jobs.filter(j => j.status === "완료").length, failedJobs: jobs.filter(j => j.status === "실패").length, pendingReports: reports.filter(r => r.status === "접수").length },
    jobs, trades, reports, audit,
  };
}
