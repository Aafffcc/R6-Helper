import type { StatsPlatform } from '@/types/stats';
import { isStatsPlatform } from '@/types/stats';

export interface FavoritePlayer {
  nickname: string;
  platform: StatsPlatform;
  /** 标星时间戳（毫秒），用于收藏列表排序 */
  starredAt: number;
}

const STORAGE_KEY = 'r6-helper:favorite-players';
const MAX_FAVORITES = 50;

/** 收藏的唯一键：同一昵称在不同平台是不同玩家 */
export function getFavoriteKey(item: { nickname: string; platform: StatsPlatform }): string {
  return `${item.platform}:${item.nickname}`;
}

function normalizeFavorite(value: unknown): FavoritePlayer | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as { nickname?: unknown; platform?: unknown; starredAt?: unknown };
  if (typeof candidate.nickname !== 'string' || !isStatsPlatform(candidate.platform)) {
    return null;
  }
  const starredAt =
    typeof candidate.starredAt === 'number' && Number.isFinite(candidate.starredAt)
      ? candidate.starredAt
      : Date.now();
  return { nickname: candidate.nickname, platform: candidate.platform, starredAt };
}

/** 读取失败（存储被清空/结构变更）时降级为空列表，不影响查询主流程 */
export function loadFavorites(): FavoritePlayer[] {
  try {
    const raw: unknown = uni.getStorageSync(STORAGE_KEY);
    if (typeof raw !== 'string' || raw === '') {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(normalizeFavorite)
      .filter((item): item is FavoritePlayer => item !== null)
      .sort((a, b) => b.starredAt - a.starredAt)
      .slice(0, MAX_FAVORITES);
  } catch (error) {
    console.warn('[favorites] 读取收藏列表失败，已降级为空列表', error);
    return [];
  }
}

export function isFavorite(item: { nickname: string; platform: StatsPlatform }): boolean {
  const key = getFavoriteKey(item);
  return loadFavorites().some((entry) => getFavoriteKey(entry) === key);
}

/** 追加或刷新收藏（重复标星会更新时间并置顶），返回写库后的最新列表 */
export function addFavorite(item: { nickname: string; platform: StatsPlatform }): FavoritePlayer[] {
  const key = getFavoriteKey(item);
  const next = [
    { nickname: item.nickname, platform: item.platform, starredAt: Date.now() },
    ...loadFavorites().filter((entry) => getFavoriteKey(entry) !== key),
  ].slice(0, MAX_FAVORITES);
  persist(next);
  return next;
}

export function removeFavorite(item: {
  nickname: string;
  platform: StatsPlatform;
}): FavoritePlayer[] {
  const key = getFavoriteKey(item);
  const next = loadFavorites().filter((entry) => getFavoriteKey(entry) !== key);
  persist(next);
  return next;
}

/** 切换收藏状态，返回最新列表与切换后的状态 */
export function toggleFavorite(item: { nickname: string; platform: StatsPlatform }): {
  favorites: FavoritePlayer[];
  starred: boolean;
} {
  if (isFavorite(item)) {
    return { favorites: removeFavorite(item), starred: false };
  }
  return { favorites: addFavorite(item), starred: true };
}

function persist(favorites: FavoritePlayer[]) {
  try {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(favorites));
  } catch (error) {
    // 写入失败不影响本次返回，仅影响下次冷启动后的列表
    console.warn('[favorites] 写入收藏列表失败', error);
  }
}
