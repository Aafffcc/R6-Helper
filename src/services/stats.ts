import { callCloudObject } from './cloud';
import type { NormalizedPlayerStats, StatsPlatform } from '@/types/stats';
import { AppError } from '@/types/errors';

export interface PlayerStatsResult {
  stats: NormalizedPlayerStats;
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
