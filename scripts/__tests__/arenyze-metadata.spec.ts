import { describe, expect, it } from 'vitest';

import {
  MetadataNormalizerError,
  normalizeCharms,
  normalizeMaps,
  normalizeSkins,
  slugifyName,
} from '../lib/arenyze-metadata.mjs';

/**
 * fixture 按 2026-10 实测的 arenyze 响应构造（字段与真实返回一致，条目为截取）。
 * 上游契约变化时：先按新响应更新 fixture 并补/改用例，再修归一化实现。
 */

const mapFixture = [
  {
    name: 'Border',
    location: 'Middle East',
    releaseDate: 'Dust Line (May 2016)',
    playlists: 'Standard, Ranked',
    mapReworked: 'March 2021',
  },
  {
    name: 'Club House',
    location: 'Germany',
    releaseDate: 'Black Ice (February 2016)',
    playlists: 'Quick Match, Ranked, Standard',
    mapReworked: '',
  },
  { name: 'Presidential Plane', location: 'Unknown', releaseDate: 'December 2015', playlists: '' },
];

const skinFixture = [
  {
    weapon: 'M590A1, L85A2, P226 Mk 25',
    name: 'Aurous Alabaster',
    rarity: 'Legendary',
    availability: 'Removed',
    bundle: 'Aurous Alabaster Seasonal Skin; Year 5 Season Pass',
    season: 'Shifting Tides',
  },
  { weapon: '', name: 'Universal Test', rarity: 'Epic', availability: 'Available' },
];

const charmFixture = [
  {
    name: 'ELITEFUZECHIBI',
    collection: 'Chibi',
    rarity: 'Legendary',
    availability: 'Available',
    bundle: '2nd Shock Army Elite',
    season: 'White Noise',
  },
  // 与上一条完全一致的重复条目：应被静默去重
  {
    name: 'ELITEFUZECHIBI',
    collection: 'Chibi',
    rarity: 'Legendary',
    availability: 'Available',
    bundle: '2nd Shock Army Elite',
    season: 'White Noise',
  },
  { name: 'LITTLEANGEL', collection: 'Chibi', rarity: 'Legendary', availability: 'Available' },
];

describe('slugifyName', () => {
  it('小写化并把非字母数字折叠为连字符', () => {
    expect(slugifyName('Club House')).toBe('club-house');
    expect(slugifyName('.44 Mag Semi-Auto')).toBe('44-mag-semi-auto');
    expect(slugifyName('AK-74M')).toBe('ak-74m');
  });

  it('空结果与非字符串输入报错', () => {
    expect(() => slugifyName('///')).toThrow(MetadataNormalizerError);
    expect(() => slugifyName(null)).toThrow(MetadataNormalizerError);
  });
});

describe('normalizeMaps', () => {
  it('按实测字段归一化，缺失 mapReworked / playlists 收敛为 null / 空数组', () => {
    const entries = normalizeMaps(mapFixture);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      id: 'border',
      name: 'Border',
      location: 'Middle East',
      releaseDate: 'Dust Line (May 2016)',
      playlists: ['Standard', 'Ranked'],
      mapReworked: 'March 2021',
    });
    expect(entries[1].id).toBe('club-house');
    expect(entries[1].mapReworked).toBeNull();
    expect(entries[2].playlists).toEqual([]);
    expect(entries[2].mapReworked).toBeNull();
  });

  it('非数组响应、缺 name 的条目直接报错（不静默丢弃）', () => {
    expect(() => normalizeMaps({ error: 'unauthorized' })).toThrow(MetadataNormalizerError);
    expect(() => normalizeMaps([{ location: 'Nowhere' }])).toThrow(/maps\[0\] 缺少有效 name/);
  });
});

describe('normalizeSkins', () => {
  it('weapon 逗号串拆为 weapons 数组，缺失可选字段收敛为 null', () => {
    const entries = normalizeSkins(skinFixture);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: 'aurous-alabaster',
      name: 'Aurous Alabaster',
      weapons: ['M590A1', 'L85A2', 'P226 Mk 25'],
      rarity: 'Legendary',
      availability: 'Removed',
      bundle: 'Aurous Alabaster Seasonal Skin; Year 5 Season Pass',
      season: 'Shifting Tides',
    });
    expect(entries[1].weapons).toEqual([]);
    expect(entries[1].bundle).toBeNull();
    expect(entries[1].season).toBeNull();
  });

  it('非数组响应直接报错', () => {
    expect(() => normalizeSkins(null)).toThrow(MetadataNormalizerError);
  });
});

describe('normalizeCharms', () => {
  it('完全一致的重复条目去重，其余字段归一化', () => {
    const entries = normalizeCharms(charmFixture);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('elitefuzechibi');
    expect(entries[0].collection).toBe('Chibi');
    expect(entries[1].bundle).toBeNull();
    expect(entries[1].season).toBeNull();
  });

  it('同名不同内容直接报错（上游脏数据人工核对）', () => {
    const conflicted = [
      ...charmFixture,
      { name: 'LITTLEANGEL', collection: 'Other', rarity: 'Rare', availability: 'Available' },
    ];
    expect(() => normalizeCharms(conflicted)).toThrow(/同名不同内容/);
  });

  it('非数组响应、缺 name 的条目直接报错', () => {
    expect(() => normalizeCharms('nope')).toThrow(MetadataNormalizerError);
    expect(() => normalizeCharms([{ collection: 'Chibi' }])).toThrow(/charms\[0\] 缺少有效 name/);
  });
});
