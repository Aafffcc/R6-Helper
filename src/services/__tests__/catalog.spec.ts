import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 工厂在静态导入求值期执行，共享状态必须经 vi.hoisted 提升，否则触发 TDZ
const envState = vi.hoisted(() => ({ assetBaseUrl: 'https://cdn.example.com/assets' }));

vi.mock('@/config/env', () => ({
  get ASSET_BASE_URL() {
    return envState.assetBaseUrl;
  },
  hasAssetBaseUrl: () => envState.assetBaseUrl !== '',
}));

import { getCatalogImageUrl, getCharms, getMaps, getSkins, getWeapons } from '@/services/catalog';
import type { CatalogEntry } from '@/types/catalog';

const entryWithImage: CatalogEntry = { id: 'oregon', name: 'Oregon', image: 'oregon.png' };
const entryWithoutImage: CatalogEntry = { id: 'border', name: 'Border', image: null };

describe('getCatalogImageUrl', () => {
  beforeEach(() => {
    envState.assetBaseUrl = 'https://cdn.example.com/assets';
  });

  it('拼接 ASSET_BASE_URL + 类目 + 图片文件名', () => {
    expect(getCatalogImageUrl(entryWithImage, 'maps')).toBe(
      'https://cdn.example.com/assets/maps/oregon.png',
    );
  });

  it('image 为 null 时返回 null（无图条目直接走占位块）', () => {
    expect(getCatalogImageUrl(entryWithoutImage, 'maps')).toBeNull();
  });

  it('未配置 ASSET_BASE_URL 时一律返回 null', () => {
    envState.assetBaseUrl = '';
    expect(getCatalogImageUrl(entryWithImage, 'maps')).toBeNull();
  });
});

describe('静态目录数据', () => {
  it('weapons 条目必有图片（requiredImage 校验通过）', () => {
    const weapons = getWeapons();
    expect(weapons.length).toBeGreaterThan(0);
    for (const weapon of weapons) {
      expect(typeof weapon.image).toBe('string');
    }
  });

  it('maps：28 条，字段与烘焙口径一致', () => {
    const maps = getMaps();
    expect(maps).toHaveLength(28);
    const border = maps.find((map) => map.id === 'border');
    expect(border).toMatchObject({
      name: 'Border',
      location: 'Middle East',
      playlists: ['Standard', 'Ranked'],
      mapReworked: 'March 2021',
      image: null,
    });
  });

  it('skins：141 条，weapon 逗号串已拆为 weapons 数组', () => {
    const skins = getSkins();
    expect(skins).toHaveLength(141);
    const first = skins.find((skin) => skin.id === 'aurous-alabaster');
    expect(first).toBeDefined();
    expect(first!.weapons.length).toBeGreaterThan(0);
    expect(first!.rarity).toBe('Legendary');
  });

  it('charms：1368 条，可选字段收敛为 null', () => {
    const charms = getCharms();
    expect(charms).toHaveLength(1368);
    const first = charms[0];
    expect(first.id).toBe('elitefuzechibi');
    expect(first.collection).toBe('Chibi');
  });
});
