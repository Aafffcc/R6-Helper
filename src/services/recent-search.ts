import type { StatsPlatform } from '@/types/stats';
import { isStatsPlatform } from '@/types/stats';

export interface RecentSearch {
  nickname: string;
  platform: StatsPlatform;
}

const STORAGE_KEY = 'r6-helper:recent-searches';
const MAX_RECENT_SEARCHES = 5;

function isRecentSearch(value: unknown): value is RecentSearch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { nickname?: unknown; platform?: unknown };
  return typeof candidate.nickname === 'string' && isStatsPlatform(candidate.platform);
}

/** 读取失败（存储被清空/结构变更）时降级为空列表，不影响查询主流程 */
export function loadRecentSearches(): RecentSearch[] {
  try {
    const raw: unknown = uni.getStorageSync(STORAGE_KEY);
    if (typeof raw !== 'string' || raw === '') {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isRecentSearch).slice(0, MAX_RECENT_SEARCHES);
  } catch (error) {
    console.warn('[recent-search] 读取查询历史失败，已降级为空列表', error);
    return [];
  }
}

export function saveRecentSearch(item: RecentSearch): RecentSearch[] {
  const next = [item, ...loadRecentSearches().filter((entry) => entry.nickname !== item.nickname)];
  const trimmed = next.slice(0, MAX_RECENT_SEARCHES);
  try {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.warn('[recent-search] 写入查询历史失败', error);
  }
  return trimmed;
}
