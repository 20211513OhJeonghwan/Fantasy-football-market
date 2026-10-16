/**
 * Presentation-only club identity: short code, primary/secondary colours and crest style.
 * BSD supplies no colours and its `code` is a display short name ("Man City"), so crests are
 * derived here. Unknown clubs get a deterministic code/colour from their name.
 * This never changes data: it only decides how a crest looks.
 */
export type CrestShape = "shield" | "round" | "heater" | "square";
export type CrestPattern = "solid" | "half" | "band" | "stripes" | "ring";
export type ClubIdentity = { code: string; primary: string; secondary: string; shape: CrestShape; pattern: CrestPattern };

type Entry = [aliases: string[], code: string, primary: string, secondary: string, shape?: CrestShape, pattern?: CrestPattern];
const CLUBS: Entry[] = [
  // Premier League
  [["arsenal"], "ARS", "#EF0107", "#FFFFFF", "shield", "band"],
  [["astonvilla"], "AVL", "#670E36", "#95BFE5", "shield", "half"],
  [["bournemouth", "afcbournemouth"], "BOU", "#DA291C", "#111111", "round", "stripes"],
  [["brentford"], "BRE", "#E30613", "#FFFFFF", "round", "stripes"],
  [["brightonhovealbion", "brighton"], "BHA", "#0057B8", "#FFFFFF", "round", "ring"],
  [["burnley"], "BUR", "#6C1D45", "#99D6EA", "shield", "half"],
  [["chelsea"], "CHE", "#034694", "#FFFFFF", "round", "ring"],
  [["coventrycity", "coventry"], "COV", "#59CBE8", "#0B2343", "shield", "band"],
  [["crystalpalace"], "CRY", "#1B458F", "#C4122E", "heater", "half"],
  [["everton"], "EVE", "#003399", "#FFFFFF", "heater", "ring"],
  [["fulham"], "FUL", "#1A1A1A", "#FFFFFF", "shield", "ring"],
  [["hullcity", "hull"], "HUL", "#F5A12D", "#111111", "round", "stripes"],
  [["ipswichtown", "ipswich"], "IPS", "#3A64A3", "#FFFFFF", "shield", "ring"],
  [["leedsunited", "leeds"], "LEE", "#1D428A", "#FFCD00", "round", "band"],
  [["leicestercity", "leicester"], "LEI", "#003090", "#FDBE11", "round", "ring"],
  [["liverpool"], "LIV", "#C8102E", "#F6EB61", "heater", "ring"],
  [["manchestercity", "mancity"], "MCI", "#6CABDD", "#1C2C5B", "round", "ring"],
  [["manchesterunited", "manunited", "manutd"], "MUN", "#DA291C", "#FBE122", "round", "band"],
  [["newcastleunited", "newcastle"], "NEW", "#241F20", "#FFFFFF", "round", "stripes"],
  [["nottinghamforest", "nottmforest"], "NFO", "#DD0000", "#FFFFFF", "shield", "ring"],
  [["sheffieldunited"], "SHU", "#EE2737", "#111111", "round", "stripes"],
  [["southampton"], "SOU", "#D71920", "#FFFFFF", "round", "stripes"],
  [["sunderland"], "SUN", "#EB172B", "#FFFFFF", "shield", "stripes"],
  [["tottenhamhotspur", "tottenham", "spurs"], "TOT", "#132257", "#FFFFFF", "shield", "ring"],
  [["westhamunited", "westham"], "WHU", "#7A263A", "#1BB1E7", "shield", "half"],
  [["wolverhamptonwanderers", "wolverhampton", "wolves"], "WOL", "#FDB913", "#231F20", "shield", "band"],
  // LaLiga
  [["alaves", "deportivoalaves"], "ALA", "#0761AF", "#FFFFFF", "shield", "stripes"],
  [["athletic", "athleticclub", "athleticbilbao"], "ATH", "#EE2523", "#FFFFFF", "shield", "stripes"],
  [["atleticomadrid", "atletico", "atleticodemadrid"], "ATM", "#CB3524", "#262E61", "heater", "stripes"],
  [["barcelona", "fcbarcelona", "barca"], "BAR", "#A50044", "#004D98", "heater", "half"],
  [["celtavigo", "celta"], "CEL", "#8AC3EE", "#E5254E", "shield", "ring"],
  [["deportivolacoruna", "deportivodelacoruna", "deportivo", "deportivoacoruna"], "DEP", "#0066B3", "#FFFFFF", "round", "stripes"],
  [["elche"], "ELC", "#05642C", "#FFFFFF", "shield", "band"],
  [["espanyol", "rcdespanyol"], "ESP", "#007FC8", "#FFFFFF", "round", "stripes"],
  [["getafe"], "GET", "#005999", "#FFFFFF", "shield", "ring"],
  [["girona"], "GIR", "#CD2534", "#FFFFFF", "shield", "stripes"],
  [["laspalmas"], "LPA", "#FFE400", "#0050A0", "round", "ring"],
  [["leganes"], "LEG", "#0055A4", "#FFFFFF", "shield", "stripes"],
  [["levante", "levanteud"], "LEV", "#B4053F", "#004D98", "shield", "half"],
  [["malaga", "malagacf"], "MAL", "#0072CE", "#FFFFFF", "round", "stripes"],
  [["mallorca", "rcdmallorca"], "MLL", "#E20613", "#111111", "shield", "band"],
  [["osasuna", "caosasuna"], "OSA", "#D91A21", "#0A346F", "shield", "ring"],
  [["racingclub", "realracingclub", "racingsantander", "racing"], "RAC", "#00A651", "#FFFFFF", "shield", "stripes"],
  [["rayovallecano", "rayo"], "RAY", "#E53027", "#FFFFFF", "shield", "band"],
  [["realbetis", "betis"], "BET", "#0BB363", "#FFFFFF", "round", "stripes"],
  [["realmadrid"], "RMA", "#FFFFFF", "#FEBE10", "round", "ring"],
  [["realsociedad"], "RSO", "#0067B1", "#FFFFFF", "round", "stripes"],
  [["realvalladolid", "valladolid"], "VLL", "#5B2C83", "#FFFFFF", "shield", "stripes"],
  [["sevilla"], "SEV", "#D81E05", "#FFFFFF", "heater", "ring"],
  [["valencia"], "VAL", "#F18E00", "#111111", "round", "ring"],
  [["villarreal"], "VIL", "#FFE667", "#005187", "round", "ring"],
  // Serie A
  [["acmilan", "milan"], "MIL", "#FB090B", "#111111", "heater", "stripes"],
  [["asroma", "roma"], "ROM", "#8E1F2F", "#F0BC42", "round", "ring"],
  [["atalanta"], "ATA", "#1E71B8", "#111111", "round", "stripes"],
  [["bologna"], "BOL", "#1A2F48", "#A21C26", "shield", "half"],
  [["cagliari"], "CAG", "#A71930", "#002350", "round", "half"],
  [["como"], "COM", "#003DA5", "#FFFFFF", "shield", "ring"],
  [["cremonese"], "CRE", "#C8102E", "#8A8D8F", "shield", "stripes"],
  [["empoli"], "EMP", "#005CA9", "#FFFFFF", "shield", "ring"],
  [["fiorentina"], "FIO", "#482E92", "#FFFFFF", "heater", "ring"],
  [["frosinone"], "FRO", "#FFD200", "#0055A4", "shield", "half"],
  [["genoa"], "GEN", "#A51D2D", "#001E46", "shield", "half"],
  [["hellasverona", "verona"], "VER", "#002B5C", "#FFD200", "shield", "band"],
  [["inter", "internazionale", "intermilan"], "INT", "#0068A8", "#111111", "round", "stripes"],
  [["juventus", "juve"], "JUV", "#111111", "#FFFFFF", "shield", "half"],
  [["lazio"], "LAZ", "#87D8F7", "#0B2343", "heater", "ring"],
  [["lecce"], "LEC", "#F7D417", "#D7141A", "round", "stripes"],
  [["monza"], "MON", "#E3001B", "#FFFFFF", "round", "band"],
  [["napoli", "sscnapoli"], "NAP", "#12A0D7", "#FFFFFF", "round", "ring"],
  [["parma"], "PAR", "#FFDF00", "#003F87", "shield", "band"],
  [["pisa"], "PIS", "#1D2B5C", "#111111", "shield", "stripes"],
  [["sassuolo"], "SAS", "#00A752", "#111111", "round", "stripes"],
  [["torino"], "TOR", "#8A1E03", "#FFFFFF", "heater", "ring"],
  [["udinese"], "UDI", "#2B2B2B", "#FFFFFF", "shield", "stripes"],
  [["venezia"], "VEN", "#F37021", "#00563F", "heater", "half"],
  // Bundesliga
  [["bayernmunchen", "bayernmunich", "bayern", "fcbayernmunchen"], "FCB", "#DC052D", "#0066B2", "round", "ring"],
  [["borussiadortmund", "dortmund"], "BVB", "#FDE100", "#111111", "round", "ring"],
  [["rbleipzig", "leipzig"], "RBL", "#DD0741", "#001F47", "round", "band"],
  [["bayerleverkusen", "bayer04leverkusen", "leverkusen"], "B04", "#E32221", "#111111", "heater", "half"],
  [["eintrachtfrankfurt", "frankfurt"], "SGE", "#E1000F", "#111111", "heater", "ring"],
  [["vfbstuttgart", "stuttgart"], "VFB", "#E32219", "#FFFFFF", "shield", "band"],
  [["scfreiburg", "freiburg"], "SCF", "#E2001A", "#111111", "shield", "ring"],
  [["tsghoffenheim", "hoffenheim", "1899hoffenheim"], "TSG", "#1C63B7", "#FFFFFF", "shield", "ring"],
  [["unionberlin", "1fcunionberlin"], "FCU", "#EB1923", "#FFE100", "round", "ring"],
  [["werderbremen", "svwerderbremen", "bremen"], "SVW", "#1D9053", "#FFFFFF", "square", "band"],
  [["fcaugsburg", "augsburg"], "FCA", "#BA3733", "#46714D", "shield", "half"],
  [["mainz05", "1fsvmainz05", "mainz"], "M05", "#C3141E", "#FFFFFF", "round", "ring"],
  [["borussiamonchengladbach", "borussiamgladbach", "monchengladbach", "gladbach"], "BMG", "#1A1A1A", "#00B04F", "shield", "half"],
  [["fckoln", "1fckoln", "koln", "cologne"], "KOE", "#ED1C24", "#FFFFFF", "shield", "ring"],
  [["hamburgersv", "hamburg"], "HSV", "#005CA9", "#111111", "square", "ring"],
  [["fcschalke04", "schalke04", "schalke"], "S04", "#004D9D", "#FFFFFF", "round", "ring"],
  [["scpaderborn07", "paderborn"], "SCP", "#005CA9", "#111111", "shield", "stripes"],
  [["sv07elversberg", "elversberg"], "SVE", "#1A1A1A", "#FFFFFF", "shield", "stripes"],
  [["vflwolfsburg", "wolfsburg"], "WOB", "#65B32E", "#FFFFFF", "round", "ring"],
  [["fcstpauli", "stpauli"], "STP", "#6B3A2A", "#FFFFFF", "shield", "half"],
  [["heidenheim", "1fcheidenheim"], "FCH", "#E30613", "#003B79", "shield", "half"],
  [["vflbochum", "bochum"], "BOC", "#005CA9", "#FFFFFF", "shield", "ring"],
  [["holsteinkiel", "kiel"], "KSV", "#003F87", "#E30613", "shield", "band"],
  // Ligue 1
  [["parissaintgermain", "psg", "parissg"], "PSG", "#004170", "#DA291C", "round", "band"],
  [["olympiquedemarseille", "marseille", "olympiquemarseille"], "OM", "#2FAEE0", "#FFFFFF", "heater", "ring"],
  [["asmonaco", "monaco"], "ASM", "#E51B22", "#FFFFFF", "heater", "half"],
  [["olympiquelyonnais", "lyon"], "OL", "#1D2D5C", "#DA0812", "round", "band"],
  [["lille", "losclille", "lilleosc"], "LIL", "#E01E13", "#20325F", "round", "ring"],
  [["rclens", "lens"], "RCL", "#FFE500", "#E30613", "shield", "band"],
  [["staderennais", "rennes"], "SRF", "#E13327", "#111111", "heater", "half"],
  [["nice", "ogcnice"], "NIC", "#C4161C", "#111111", "shield", "stripes"],
  [["rcstrasbourg", "strasbourg"], "RCS", "#009FE3", "#FFFFFF", "shield", "ring"],
  [["stadebrestois", "brest", "stadebrestois29"], "SB29", "#E30613", "#FFFFFF", "round", "ring"],
  [["toulouse"], "TFC", "#5A3E99", "#FFFFFF", "heater", "ring"],
  [["nantes", "fcnantes"], "FCN", "#FCD405", "#00843D", "round", "ring"],
  [["auxerre", "ajauxerre"], "AJA", "#0055A4", "#FFFFFF", "shield", "ring"],
  [["angers", "angerssco"], "SCO", "#1A1A1A", "#FFFFFF", "shield", "stripes"],
  [["lehavre", "havre", "lehavreac"], "HAC", "#95C1E8", "#0E2C5E", "round", "half"],
  [["lorient", "fclorient"], "FCL", "#F58113", "#111111", "shield", "ring"],
  [["parisfc"], "PFC", "#0B2D5B", "#8FB8E0", "round", "band"],
  [["metz", "fcmetz"], "FCM", "#8E1B3B", "#FFFFFF", "heater", "ring"],
  [["troyes", "estac", "estactroyes"], "TRO", "#003F87", "#FFFFFF", "shield", "band"],
  [["lemans", "lemansfc"], "LEM", "#E30613", "#FFD100", "round", "half"],
  [["montpellier"], "MHSC", "#F37121", "#00287A", "shield", "half"],
  [["reims", "stadedereims"], "SDR", "#E10019", "#FFFFFF", "round", "ring"],
  [["saintetienne", "assaintetienne"], "ASSE", "#009A4E", "#FFFFFF", "shield", "ring"],
];

/** Lower-case, accent-free, alphanumeric only. "Borussia M'gladbach" → "borussiamgladbach". */
export function clubKey(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9]/g, "");
}
const STOP = /^(fc|cf|afc|ac|as|ssc|sc|rc|rcd|sv|vfb|vfl|tsg|ud|cd|ca|ogc|us|ss|aj|1|club|de|del|la|le|the)$/;
function stripped(name: string) {
  return clubKey(name.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s.\-']+/).filter((w) => !STOP.test(w.toLowerCase())).join(""));
}
const INDEX = new Map<string, Entry>();
for (const entry of CLUBS) for (const alias of entry[0]) INDEX.set(alias, entry);

/** Curated fallback pairs so generated crests still look intentional. */
const FALLBACK: [string, string][] = [
  ["#1F4E9E", "#FFFFFF"], ["#B3172B", "#FFFFFF"], ["#0E7A4B", "#FFFFFF"], ["#5A3E99", "#FFFFFF"],
  ["#111111", "#FFE23A"], ["#E36414", "#111111"], ["#0F6E8C", "#FFFFFF"], ["#7A263A", "#F0BC42"],
  ["#2B2B2B", "#E30613"], ["#004170", "#8FB8E0"], ["#8A1E03", "#F6EB61"], ["#24693D", "#FFE23A"],
];
const SHAPES: CrestShape[] = ["shield", "round", "heater", "square"];
const PATTERNS: CrestPattern[] = ["band", "half", "ring", "stripes"];
function hash(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function fallbackCode(name: string) {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s.\-'&]+/).filter((w) => w && !STOP.test(w.toLowerCase()) && !/^\d+$/.test(w));
  if (!words.length) return name.slice(0, 3).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}
const cache = new Map<string, ClubIdentity>();
export function clubIdentity(team: { id: string; name: string; english?: string | null; code?: string | null; color?: string | null } | null | undefined): ClubIdentity | null {
  if (!team) return null;
  const cached = cache.get(team.id);
  if (cached) return cached;
  const candidates = [team.name, team.english, team.code].filter(Boolean) as string[];
  let entry: Entry | undefined;
  for (const value of candidates) entry ??= INDEX.get(clubKey(value)) ?? INDEX.get(stripped(value));
  const h = hash(team.id + team.name);
  const stored = team.color && /^#[0-9a-f]{6}$/i.test(team.color) ? team.color : null;
  const [primary, secondary] = entry ? [entry[2], entry[3]] : stored ? [stored, "#FFFFFF"] : FALLBACK[h % FALLBACK.length];
  const identity: ClubIdentity = {
    code: entry?.[1] ?? fallbackCode(team.english || team.name),
    primary: stored && !entry ? stored : primary,
    secondary,
    shape: entry?.[4] ?? SHAPES[h % SHAPES.length],
    pattern: entry?.[5] ?? PATTERNS[(h >>> 3) % PATTERNS.length],
  };
  cache.set(team.id, identity);
  return identity;
}
/** Relative luminance (0..1) so text on a crest stays readable. */
export function luminance(hex: string) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** League marks for headers and filters (presentation only). */
const LEAGUES: [RegExp, { short: string; color: string; ink: string; country: string }][] = [
  // Club competitions first: their names can contain "리그" and must not fall through to a domestic league.
  [/champions ?league|챔피언스 ?리그/i, { short: "UCL", color: "#0B1F5C", ink: "#FFFFFF", country: "유럽" }],
  [/europa ?league|유로파/i, { short: "UEL", color: "#F28A00", ink: "#111110", country: "유럽" }],
  [/conference ?league|컨퍼런스/i, { short: "UECL", color: "#17A85A", ink: "#FFFFFF", country: "유럽" }],
  [/uefa ?super ?cup|uefa ?슈퍼컵/i, { short: "USC", color: "#1D3E8F", ink: "#FFFFFF", country: "유럽" }],
  [/fa ?cup|fa ?컵/i, { short: "FA CUP", color: "#C8102E", ink: "#FFFFFF", country: "잉글랜드" }],
  [/carabao|efl ?cup|league ?cup|카라바오/i, { short: "EFL CUP", color: "#00A651", ink: "#FFFFFF", country: "잉글랜드" }],
  [/copa del rey|코파 ?델 ?레이/i, { short: "COPA", color: "#8C1D2B", ink: "#FFD200", country: "스페인" }],
  [/coppa italia|코파 ?이탈리아/i, { short: "COPPA", color: "#008C45", ink: "#FFFFFF", country: "이탈리아" }],
  [/dfb|포칼/i, { short: "DFB", color: "#111110", ink: "#FFD200", country: "독일" }],
  [/coupe de france|쿠프 ?드 ?프랑스/i, { short: "CDF", color: "#1F3B8C", ink: "#FFFFFF", country: "프랑스" }],
  [/premier|프리미어/i, { short: "EPL", color: "#3D195B", ink: "#FFFFFF", country: "잉글랜드" }],
  [/la ?liga|laliga|라리가/i, { short: "LALIGA", color: "#FF4B44", ink: "#FFFFFF", country: "스페인" }],
  [/serie ?a|세리에/i, { short: "SERIE A", color: "#0A2C6E", ink: "#FFFFFF", country: "이탈리아" }],
  [/bundesliga|분데스리가/i, { short: "BUNDESLIGA", color: "#D20515", ink: "#FFFFFF", country: "독일" }],
  [/ligue ?1|리그 ?1/i, { short: "LIGUE 1", color: "#0B1E3F", ink: "#DAE025", country: "프랑스" }],
];
export function leagueIdentity(league: { name: string } | null | undefined) {
  if (!league) return null;
  return LEAGUES.find(([pattern]) => pattern.test(league.name))?.[1] ?? { short: league.name.slice(0, 10).toUpperCase(), color: "#111111", ink: "#FFE23A", country: "" };
}
