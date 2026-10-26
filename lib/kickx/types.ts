/** View models returned by the server. Null means unknown, never a fabricated zero. */
export type Position = "GK" | "DF" | "MF" | "FW";
export type SeriesPoint = { at: string; value: number };
export type Team = {
  id: string;
  name: string;
  english: string | null;
  code: string | null;
  color: string | null;
  leagueId: string | null;
};
export type League = { id: string; name: string };
export type PlayerRecord = {
  id: string;
  /** Fixture and competition of the record when the server provides them. */
  fixtureId?: string | null;
  leagueId?: string | null;
  /** True only when a finished match has its own published price change. */
  reportAvailable?: boolean;
  playedAt: string;
  opponent: string;
  result: string | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  performance: number | null;
};
export type Player = {
  id: string;
  name: string;
  english: string | null;
  originalName?: string;
  aliases?: string[];
  scoreDetails?: {fixture_id: string; score: number | null; status: string; rule_version: string; breakdown: {metric:string;value:number;points:number;evidence:string}[]; warnings:string[]}[];
  pricing?: {
    baseline: {referenceHash?:string;percentile?:number;lower?:number;upper?:number;source:string;season:number|null;gameCount:number;meanScore:number|null;seedScore:number;price:number;warnings:string[]} | null;
    recent: {fixture_id:string;played_at:string;price_before:number;price_after:number;target_price:number;form_score:number;change_percent:number;window_fixture_ids:string[]}[];
  };
  short: string | null;
  team: string | null;
  position: Position | null;
  country: string | null;
  age: number | null;
  season?: number | null;
  statsScope?: string | null;
  importedMatches?: number | null;
  price: number | null;
  change: number | null;
  performance: number | null;
  volume: number | null;
  goals: number | null;
  assists: number | null;
  minutes: number | null;
  history: SeriesPoint[];
  records: PlayerRecord[];
  analysis: string | null;
  updatedAt: string | null;
  status: string | null;
  tradeWindow?: {locked:boolean;fixtureId?:string;startsAt?:string;finishedAt?:string|null;unlockAt?:string|null};
  /** Licensed photo URL. Null/undefined renders the illustrated placeholder. */
  photo?: string | null;
};
export type Fixture = {
  id: string;
  leagueId: string | null;
  home: string;
  away: string;
  startsAt: string;
  status: string;
  homeScore?: number | null;
  awayScore?: number | null;
  stage?: string | null;
  roundLabel?: string | null;
  penaltiesHome?: number | null;
  penaltiesAway?: number | null;
  reflectionStatus?: string | null;
};
export type Formation = { id: string; name: string; positions: Position[] };
export type Transaction = {
  id: string;
  playerId: string;
  playerName: string;
  type: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  net: number;
  date: string;
  status: string;
};
export type Holding = {
  id: string;
  playerId: string;
  playerName: string;
  quantity: number;
  cost: number;
  value: number | null;
  profit: number | null;
  returnRate: number | null;
};
export type Post = {
  id: string;
  author: string;
  authorId: string;
  scope: "club" | "player";
  target: string;
  title: string;
  body: string;
  date: string;
  likes: number;
  views: number;
  commentCount: number;
  transaction: Transaction | null;
  targetName?: string;
  revision?: number;
  liked?: boolean;
};
export type Comment = {
  id: string;
  postId: string;
  author: string;
  authorId: string;
  body: string;
  date: string;
  parentId?: string | null;
  revision?: number;
};
export type Profile = { nickname: string; team: string | null; teams?: string[] };
export type Session = {
  userId: string;
  role: "member" | "admin";
  profile: Profile | null;
};
export type MemberData = {
  /** False while the ledger/holdings service is not connected. */
  financialReady?: boolean;
  ownedPlayers?: Player[];
  transactionTotal?: number;
  realizedProfit?: number | null;
  points: number | null;
  totalAssets: number | null;
  playerAssets: number | null;
  profit: number | null;
  returnRate: number | null;
  weeklyRank: number | null;
  holdings: Holding[];
  transactions: Transaction[];
  watchlist: string[];
  assetHistory: SeriesPoint[];
  squad: {
    revision?: number;
    formationId: string;
    slots: (string | null)[];
    value: number | null;
    performance: number | null;
  } | null;
};
export type RankingRow = {
  userId: string;
  rank: number;
  nickname: string;
  team: string | null;
  teams?: string[];
  assets: number | null;
  returnRate: number | null;
};
export type RankingPeriod = {
  id: "weekly" | "monthly";
  startsAt: string;
  endsAt: string;
  calculatedAt: string;
  rows: RankingRow[];
};
export type PublicData = {
  freshness?: {lastCheckedAt:string|null;lastSuccessAt:string|null;lastError:string|null;priceUpdatedAt:string|null;workerRunning:boolean|null} | null;
  communityCounts?: {scope:"club"|"player";target:string;count:number}[];
  policy?: {version:string;initialPoints:number;initialPrice:number;sellFeeBps:number;quoteSeconds:number;clubCompetitionsEnabled?:boolean} | null;
  /** Total DB catalog count; players below are bounded previews. */
  playerTotal?: number;
  players: Player[];
  teams: Team[];
  leagues: League[];
  fixtures: Fixture[];
  formations: Formation[];
  posts: Post[];
  comments: Comment[];
  rankings: RankingPeriod[];
  market: {
    pricedPlayers?: number;
    volume: number | null;
    rising: number | null;
    falling: number | null;
    calculatedAt: string | null;
  } | null;
  updatedAt: string | null;
};
export type PlatformData = PublicData & {
  session: Session | null;
  member: MemberData | null;
};
export type IngestionRun = {
  id: string; status: "running" | "paused" | "completed" | "cancelled";
  started_at: string; updated_at: string; finished_at: string | null;
  total_tasks: number; completed_tasks: number; warnings: number; requests: number; rows_written: number;
  error_code: string | null; retry_at: string | null; remaining: number | null; lease_until: string | null;
};
export type IngestionState = {
  enabled: boolean; reason: string | null; latest: IngestionRun | null;
  current: { label: string; kind: string } | null;
  warnings: { label: string; warning: string }[]; runs: IngestionRun[];
};
export type AdminData = {
  prototypeReady?: boolean;
  calculationIssues?: {player_id:string;fixture_id:string;status:string;warnings:string[]}[];
  ingestion?: IngestionState;
  summary: {
    members?: number | null;
    restrictedMembers?: number | null;
    trades?: number | null;
    players: number | null;
    completedJobs: number | null;
    failedJobs: number | null;
    pendingReports: number | null;
  } | null;
  jobs: {
    id: string;
    name: string;
    kind: string;
    target: string;
    time: string;
    status: string;
    success: number | null;
    fail: number | null;
    error: string | null;
  }[];
  trades: (Transaction & { userId: string })[];
  reports: {
    commentId?: string | null;
    content?: string;
    id: string;
    postId: string;
    title: string;
    reason: string;
    status: string;
    date: string;
  }[];
  audit: { id: string; description: string; date: string }[];
};
export type DataStatus =
  | "loading"
  | "not-configured"
  | "ready"
  | "error"
  | "unauthorized"
  | "forbidden";
/** "mock" marks development sample data. The UI must always label it as such. */
export type DataSource = "database" | "mock";
export type DataResponse<T> = {
  status: "ready" | "not-configured";
  data: T;
  source?: DataSource;
};
/** Price quote shown before a trade is confirmed. Produced by the trade service, never computed in the UI. */
export type TradeQuote = {
  id?: string;
  expiresAt?: string;
  policyVersion?: string;
  playerId: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number | null;
  settlement: number | null;
  balance: number | null;
  balanceAfter: number | null;
  quotedAt: string;
};
