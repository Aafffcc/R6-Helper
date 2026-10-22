/**
 * 战绩领域类型。
 * NormalizedPlayerStats 契约的唯一来源是 stats-core 公共模块的类型声明，
 * 客户端只做转发，禁止在页面里另写一套口径。
 */

export type {
  NormalizedIdentity,
  NormalizedModeStats,
  NormalizedPlayerStats,
  NormalizedRankedSummary,
  RpHistoryPoint,
} from '../../uniCloud-alipay/cloudfunctions/common/stats-core';

export type StatsPlatform = 'pc' | 'psn' | 'xbox';

export interface StatsPlatformOption {
  value: StatsPlatform;
  label: string;
}

export const STATS_PLATFORM_OPTIONS: readonly StatsPlatformOption[] = [
  { value: 'pc', label: 'PC' },
  { value: 'psn', label: 'PSN' },
  { value: 'xbox', label: 'Xbox' },
];

export function isStatsPlatform(value: unknown): value is StatsPlatform {
  return value === 'pc' || value === 'psn' || value === 'xbox';
}
