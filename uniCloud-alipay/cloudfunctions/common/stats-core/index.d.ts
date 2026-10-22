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
}

export interface RpHistoryPoint {
  /** 毫秒时间戳；上游量级无法判定时为 null */
  timestamp: number | null;
  rp: number | null;
  /** 该时点段位名（上游 metadata.rank），未知为 null */
  rank: string | null;
}

export interface NormalizedIdentity {
  nickname: string;
  platform: string;
  profileId: string | null;
  avatarUrl: string | null;
  level: number | null;
}

export interface NormalizedRankedSummary {
  season: { id: string | null; name: string | null };
  rank: { name: string | null };
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
}

export declare const STATS_CACHE_TTL_MS: number;
export declare const PLATFORMS: string[];
export declare const DEFAULT_PLATFORM: string;
export declare const NICKNAME_MAX_LENGTH: number;
export declare const RP_HISTORY_MAX_POINTS: number;

export declare function normalizeRatio(value: unknown): number | null;

export declare function normalizeRpHistory(raw: unknown): RpHistoryPoint[];

export declare function normalizeUpstreamStats(
  raw: unknown,
  fallbackIdentity: { nickname: string; platform: string },
): NormalizedPlayerStats;

export declare function validatePlayerStatsQuery(params: unknown): PlayerStatsQuery;

export declare function normalizeCacheKey(platform: string, nickname: string): string;

export declare function createArenyzeClient(
  config: { apiKey?: string; baseUrl?: string } & Record<string, unknown>,
  fetchImpl?: unknown,
): UpstreamClient;

export declare function createUpstreamClient(config: UpstreamConfig | null): UpstreamClient;

export declare function createCoreError(errCode: string, errMsg: string): StatsCoreError;
