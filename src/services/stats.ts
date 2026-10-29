import { callCloudObject } from './cloud';
import type {
  NormalizedMatchSummary,
  NormalizedOperatorStats,
  NormalizedPlayerStats,
  StatsPlatform,
} from '@/types/stats';
import { AppError } from '@/types/errors';

export interface PlayerStatsResult {
  stats: NormalizedPlayerStats;
  fromCache: boolean;
}

export interface PlayerOperatorsResult {
  operators: NormalizedOperatorStats[];
  fromCache: boolean;
}

export interface PlayerMatchesResult {
  matches: NormalizedMatchSummary[];
  /** 下一页游标（毫秒时间戳），null 表示没有更早对局 */
  nextBefore: number | null;
  fromCache: boolean;
}

/**
 * 云端返回结构做最小完整性校验：identity 缺失视为结构异常，
 * ranked / casual 允许为 null（未知即 null 的口径）。
 */
function isNormalizedPlayerStats(value: unknown): value is NormalizedPlayerStats {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { identity?: unknown; ranked?: unknown; casual?: unknown };
  if (typeof candidate.identity !== 'object' || candidate.identity === null) {
    return false;
  }
  const identity = candidate.identity as { nickname?: unknown; platform?: unknown };
  return typeof identity.nickname === 'string' && typeof identity.platform === 'string';
}

export async function fetchPlayerStats(
  nickname: string,
  platform: StatsPlatform,
): Promise<PlayerStatsResult> {
  const result = await callCloudObject<{ stats?: unknown; fromCache?: unknown }>(
    'stats',
    'getPlayerStats',
    { nickname, platform },
  );
  if (!isNormalizedPlayerStats(result?.stats)) {
    throw new AppError('E_UNKNOWN', '云端返回的战绩结构异常');
  }
  return { stats: result.stats, fromCache: result.fromCache === true };
}

export async function fetchPlayerOperators(
  nickname: string,
  platform: StatsPlatform,
): Promise<PlayerOperatorsResult> {
  const result = await callCloudObject<{ operators?: unknown; fromCache?: unknown }>(
    'stats',
    'getPlayerOperators',
    { nickname, platform },
  );
  if (!Array.isArray(result?.operators)) {
    throw new AppError('E_UNKNOWN', '云端返回的干员统计结构异常');
  }
  return {
    operators: result.operators as NormalizedOperatorStats[],
    fromCache: result.fromCache === true,
  };
}

/**
 * 对局记录（育碧官方上游）。before 为“加载更多”游标，
 * 取上一页响应的 nextBefore（页内最早已知对局时间）。
 */
export async function fetchPlayerMatches(
  nickname: string,
  platform: StatsPlatform,
  before: number | null = null,
): Promise<PlayerMatchesResult> {
  const result = await callCloudObject<{
    matches?: unknown;
    nextBefore?: unknown;
    fromCache?: unknown;
  }>('stats', 'getPlayerMatches', { nickname, platform, before });
  if (!Array.isArray(result?.matches)) {
    throw new AppError('E_UNKNOWN', '云端返回的对局记录结构异常');
  }
  const matches = result.matches as NormalizedMatchSummary[];
  // 形状守卫：缺 id 的条目视为结构异常，避免渲染层拿到脏数据
  if (matches.some((match) => typeof match?.id !== 'string' || match.id === '')) {
    throw new AppError('E_UNKNOWN', '云端返回的对局记录结构异常');
  }
  return {
    matches,
    nextBefore: typeof result.nextBefore === 'number' ? result.nextBefore : null,
    fromCache: result.fromCache === true,
  };
}
