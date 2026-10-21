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
}

export interface NormalizedPlayerStats {
  identity: NormalizedIdentity;
  ranked: NormalizedRankedSummary | null;
  casual: NormalizedModeStats | null;
}

export interface PlayerStatsQuery {
  nickname: string;
  platform: string;
}

export interface UpstreamConfig {
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

export declare function normalizeUpstreamStats(
  raw: unknown,
  fallbackIdentity: { nickname: string; platform: string },
): NormalizedPlayerStats;

export declare function validatePlayerStatsQuery(params: unknown): PlayerStatsQuery;

export declare function normalizeCacheKey(platform: string, nickname: string): string;

export declare function createUpstreamClient(config: UpstreamConfig | null): UpstreamClient;

export declare function createCoreError(errCode: string, errMsg: string): StatsCoreError;
