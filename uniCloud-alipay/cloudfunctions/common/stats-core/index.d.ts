/**
 * stats-core 公共模块类型声明，与 index.js 实现保持同口径。
 * 客户端（src/types/stats.ts）直接复用本文件的 NormalizedPlayerStats 契约。
 */

export interface NormalizedModeStats {
  wins: number | null;
  losses: number | null;
  winRate: number | null;
  kills: number | null;
  deaths: number | null;
  kd: number | null;
  /** 爆头率，0..1 口径；上游未提供该模式的口径时为 null */
  hsPercent: number | null;
}

export interface RpHistoryPoint {
  /** 毫秒时间戳；上游量级无法判定时为 null */
  timestamp: number | null;
  rp: number | null;
  /** 该时点段位名（上游 metadata.rank），未知为 null */
  rank: string | null;
}

/** 往赛季排位历史记录（seasonHistory 出口，只汇总不参与当前赛季兜底） */
export interface NormalizedSeasonRecord {
  /** 全局赛季编号（Y11S3 = 43），未知为 null */
  seasonNumber: number | null;
  /** 赛季标签（如 Y11S3；上游 shortName 缺失时按编号推导） */
  seasonId: string | null;
  /** 赛季名称（如 Split Fire）；与标签同值或未知为 null */
  seasonName: string | null;
  /** 结算段位名（上游分段 metadata.rank），未知为 null */
  finalRankName: string | null;
  /** 结算 RP（分段 rankPoints） */
  finalRp: number | null;
  /** 赛季内最高 RP（分段 maxRankPoints），上游未提供为 null */
  maxRp: number | null;
  matches: NormalizedModeStats;
}

/** 单个干员的聚合统计（v2/operators，全模式聚合、当前赛季口径） */
export interface NormalizedOperatorStats {
  name: string;
  side: string | null;
  rounds: number | null;
  wins: number | null;
  losses: number | null;
  winRate: number | null;
  kills: number | null;
  deaths: number | null;
  kd: number | null;
  hsPercent: number | null;
}

export interface NormalizedIdentity {
  nickname: string;
  platform: string;
  profileId: string | null;
  avatarUrl: string | null;
  level: number | null;
}

/**
 * 单场对局摘要（育碧官方对局历史，查询玩家本人分段）。
 * 除 id/platform 外全部可空：未知数据 null，真实 0 保留。
 */
export interface NormalizedMatchSummary {
  id: string;
  platform: string;
  /** 归一模式口径：ranked / unranked / casual / other，未知 null */
  mode: 'ranked' | 'unranked' | 'casual' | 'other' | null;
  map: string | null;
  result: 'win' | 'loss' | null;
  roundsWon: number | null;
  roundsLost: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  /** RP 变化，仅排位对局保留（RP 与 MMR 分开口径） */
  rpChange: number | null;
  /** 对局后 RP，仅排位对局保留 */
  rpAfter: number | null;
  /** 对局完成时间（毫秒），未知 null */
  playedAt: number | null;
  /** 对局时长（秒），未知 null */
  durationSeconds: number | null;
}

/** 育碧会话（ticket + 过期时间），由云对象落库复用 */
export interface UbiSession {
  ticket: string;
  sessionId: string | null;
  expiresAt: number;
}

/** 育碧会话存取回调：生产为 DB 实现（ubi-session 集合），测试注入内存实现 */
export interface UbiSessionStore {
  loadSession?(): Promise<unknown>;
  saveSession?(session: unknown): Promise<void>;
}

export interface UbiClientConfig {
  /** 专用小号邮箱，只允许来自 uni-config-center，禁止落日志 */
  email: string;
  password: string;
  /** 缺省 UBI_APP_ID_DEFAULT；探针实测后建议在 config 固定 */
  appId?: string;
  authBaseUrl?: string;
  apiBaseUrl?: string;
}

export interface PlayerMatchQuery {
  nickname: string;
  platform: string;
  /** “加载更多”游标（毫秒时间戳），缺省/null 表示首页 */
  before?: number | null;
  /** 已缓存的育碧 profileId；缺省时客户端自行档案查找 */
  profileId?: string | null;
}

export interface NormalizedRankedSummary {
  season: { id: string | null; name: string | null };
  rank: {
    name: string | null;
    /** 赛季内最高段位名（RP 历史中 RP 最高的带名时点），未知为 null */
    max: string | null;
  };
  rp: { current: number | null; max: number | null };
  mmr: { current: number | null; peak: number | null };
  matches: NormalizedModeStats;
  /** 爆头率，0..1 口径；上游未提供为 null */
  hsPercent: number | null;
  /** 赛季内 RP 随时间变化序列（RP 趋势图数据源），时间升序（上游原始顺序为新→旧，适配器已反转） */
  rpHistory: RpHistoryPoint[];
}

export interface NormalizedPlayerStats {
  identity: NormalizedIdentity;
  ranked: NormalizedRankedSummary | null;
  casual: NormalizedModeStats | null;
  unranked: NormalizedModeStats | null;
  /** 活动（event）模式，上游无该分段为 null */
  event: NormalizedModeStats | null;
  /** 往赛季排位历史（含当前赛季），按赛季号降序 */
  seasonHistory: NormalizedSeasonRecord[];
}

export interface PlayerStatsQuery {
  nickname: string;
  platform: string;
}

export interface UpstreamConfig {
  /** 数据源标识：'arenyze' 启用 arenyze 适配器 */
  provider?: string;
  /** arenyze API Key，只允许来自 uni-config-center，禁止落日志 */
  apiKey?: string;
  /** 缺省为 https://public-api.arenyze.com/r6/api */
  baseUrl?: string;
  /** 仅测试注入：自定义 fetch 实现 */
  fetchImpl?: unknown;
  [key: string]: unknown;
}

export interface StatsCoreError extends Error {
  errCode: string;
}

export interface UpstreamClient {
  fetchPlayerStats(query: PlayerStatsQuery): Promise<unknown>;
  fetchPlayerOperators(query: PlayerStatsQuery): Promise<unknown>;
  /** 育碧对局历史原始载荷；未配置 ubi 凭据时抛 E_UPSTREAM_NOT_CONFIGURED */
  fetchPlayerMatches(query: PlayerMatchQuery): Promise<unknown>;
}

export interface UbiClient {
  login(): Promise<UbiSession>;
  ensureSession(force?: boolean): Promise<UbiSession>;
  /** 按昵称查找育碧 profileId，未找到抛 E_NOT_FOUND */
  lookupProfile(nickname: string, platform: string): Promise<string>;
  fetchPlayerMatches(query: PlayerMatchQuery): Promise<unknown>;
}

export interface NormalizedMatchPage {
  matches: NormalizedMatchSummary[];
  /** 页内最早已知对局时间（毫秒），作为下一页 before 游标；整页未知为 null */
  oldestPlayedAt: number | null;
}

export declare const STATS_CACHE_TTL_MS: number;
export declare const OPERATORS_CACHE_TTL_MS: number;
export declare const PLATFORMS: string[];
export declare const DEFAULT_PLATFORM: string;
export declare const NICKNAME_MAX_LENGTH: number;
export declare const RP_HISTORY_MAX_POINTS: number;
export declare const UBI_AUTH_BASE_URL: string;
export declare const UBI_API_BASE_URL: string;
export declare const UBI_APP_ID_DEFAULT: string;
export declare const UBI_SPACE_IDS: Record<string, string>;
export declare const UBI_SESSION_TTL_MS: number;
export declare const MATCHES_PAGE_SIZE: number;
export declare const MATCHES_LIST_TTL_MS: number;
export declare const MATCH_TTL_MS: number;
export declare const PLAYER_UID_TTL_MS: number;

export declare function normalizeRatio(value: unknown): number | null;

export declare function normalizeRpHistory(raw: unknown): RpHistoryPoint[];

export declare function normalizeUpstreamStats(
  raw: unknown,
  fallbackIdentity: { nickname: string; platform: string },
): NormalizedPlayerStats;

export declare function normalizeOperatorStats(raw: unknown): NormalizedOperatorStats[];

export declare function normalizeUbiMatches(
  raw: unknown,
  context: { platform: string; profileId?: string | null },
): NormalizedMatchPage;

export declare function validatePlayerStatsQuery(params: unknown): PlayerStatsQuery;

export declare function validatePlayerMatchesQuery(
  params: unknown,
): PlayerStatsQuery & { before: number | null };

export declare function normalizeCacheKey(platform: string, nickname: string): string;

export declare function createArenyzeClient(
  config: { apiKey?: string; baseUrl?: string } & Record<string, unknown>,
  fetchImpl?: unknown,
): UpstreamClient;

export declare function createUbiClient(
  config: UbiClientConfig,
  deps?: { fetchImpl?: unknown; loadSession?: unknown; saveSession?: unknown },
): UbiClient;

export declare function createUpstreamClient(
  config: UpstreamConfig | null,
  sessionStore?: UbiSessionStore,
): UpstreamClient;

/** 读取 config.ubi 段并收敛为客户端凭据结构；缺失或凭据为空返回 null */
export declare function readUbiCredentials(
  config: Record<string, unknown>,
): { email: string; password: string; appId?: string } | null;

export declare function createCoreError(errCode: string, errMsg: string): StatsCoreError;
