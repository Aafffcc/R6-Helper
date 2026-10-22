import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addFavorite,
  getFavoriteKey,
  isFavorite,
  loadFavorites,
  toggleFavorite,
} from '../favorites';
import type { StatsPlatform } from '@/types/stats';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('favorites（收藏玩家本地存储）', () => {
  it('空存储降级为空列表', () => {
    expect(loadFavorites()).toEqual([]);
  });

  it('getFavoriteKey 以 平台:昵称 区分玩家', () => {
    expect(getFavoriteKey({ nickname: 'Beaulo', platform: 'pc' })).toBe('pc:Beaulo');
    expect(getFavoriteKey({ nickname: 'Beaulo', platform: 'psn' })).toBe('psn:Beaulo');
  });

  it('addFavorite 去重置顶并持久化', () => {
    addFavorite({ nickname: 'A', platform: 'pc' });
    addFavorite({ nickname: 'B', platform: 'psn' });
    const list = addFavorite({ nickname: 'A', platform: 'pc' });

    expect(list).toHaveLength(2);
    expect(list[0]?.nickname).toBe('A');
    expect(JSON.parse(storage.get('r6-helper:favorite-players') ?? '[]')).toHaveLength(2);
  });

  it('isFavorite / removeFavorite / toggleFavorite 状态一致', () => {
    const target: { nickname: string; platform: StatsPlatform } = {
      nickname: 'Beaulo',
      platform: 'pc',
    };
    expect(isFavorite(target)).toBe(false);

    const added = toggleFavorite(target);
    expect(added.starred).toBe(true);
    expect(isFavorite(target)).toBe(true);

    const removed = toggleFavorite(target);
    expect(removed.starred).toBe(false);
    expect(isFavorite(target)).toBe(false);
  });

  it('超出上限 50 时丢弃最旧的收藏', () => {
    for (let i = 0; i < 55; i += 1) {
      addFavorite({ nickname: `player-${i}`, platform: 'pc' });
    }
    const list = loadFavorites();
    expect(list).toHaveLength(50);
    expect(list.some((entry) => entry.nickname === 'player-0')).toBe(false);
    expect(list.some((entry) => entry.nickname === 'player-54')).toBe(true);
  });

  it('损坏的存储内容降级为空列表，不抛错', () => {
    storage.set('r6-helper:favorite-players', '{not-json');
    expect(loadFavorites()).toEqual([]);

    storage.set('r6-helper:favorite-players', JSON.stringify({ wrong: 'shape' }));
    expect(loadFavorites()).toEqual([]);
  });

  it('非法条目被过滤，缺失 starredAt 时补当前时间', () => {
    storage.set(
      'r6-helper:favorite-players',
      JSON.stringify([
        { nickname: 'ok', platform: 'pc', starredAt: 1000 },
        { nickname: 'bad-platform', platform: 'switch' },
        { nickname: 'ok2', platform: 'xbox' },
      ]),
    );
    const list = loadFavorites();
    expect(list.map((entry) => entry.nickname)).toEqual(['ok2', 'ok']);
    expect(list[1]?.starredAt).toBe(1000);
    expect(list[0]?.starredAt).toBeGreaterThan(0);
  });
});
