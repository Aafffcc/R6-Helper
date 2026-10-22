import { describe, expect, it } from 'vitest';

import {
  normalizeCacheKey,
  normalizeRatio,
  normalizeRpHistory,
  normalizeUpstreamStats,
  validatePlayerStatsQuery,
} from '../index';

describe('validatePlayerStatsQuery', () => {
  it('接受合法入参并裁剪昵称空白', () => {
    expect(validatePlayerStatsQuery({ nickname: '  Beaulo  ', platform: 'psn' })).toEqual({
      nickname: 'Beaulo',
      platform: 'psn',
    });
  });

  it('platform 缺省时按 pc 口径处理', () => {
    expect(validatePlayerStatsQuery({ nickname: 'Beaulo' })).toEqual({
      nickname: 'Beaulo',
      platform: 'pc',
    });
  });

  it('拒绝空昵称与非 null/undefined 的非法平台', () => {
    expect(() => validatePlayerStatsQuery({})).toThrowError(/nickname/);
    expect(() => validatePlayerStatsQuery({ nickname: '', platform: 'pc' })).toThrowError(
      /nickname/,
    );
    expect(() => validatePlayerStatsQuery({ nickname: 'a', platform: 'switch' })).toThrowError(
      /platform/,
    );
  });

  it('拒绝超长昵称与非对象入参', () => {
    expect(() => validatePlayerStatsQuery({ nickname: 'x'.repeat(33) })).toThrowError(/长度/);
    expect(() => validatePlayerStatsQuery(null)).toThrowError(/nickname/);
  });
});

describe('normalizeUpstreamStats（战绩归一化回归口径）', () => {
  it('完整上游数据逐字段映射，胜率与 K/D 正确计算，RP 与 MMR 分开', () => {
    const stats = normalizeUpstreamStats(
      {
        identity: { profileId: 'p-1', avatarUrl: 'https://a/b.png', level: 210 },
        ranked: {
          seasonId: 'Y10S3',
          seasonName: 'High Stakes',
          rankName: 'Champion',
          rp: { current: 4321, max: 4400 },
          mmr: { current: 4321, peak: 4600 },
          wins: 120,
          losses: 80,
          kills: 1500,
          deaths: 1200,
          hsPercent: 57.89,
          rpHistory: [
            [1758000000, { value: 4200, metadata: { rank: 'Diamond' } }],
            [1758100000, { value: 4321, metadata: { rank: 'Champion' } }],
          ],
        },
        casual: { wins: 50, losses: 50, kills: 600, deaths: 500 },
        unranked: { wins: 8, losses: 4, kills: 70, deaths: 60 },
      },
      { nickname: 'fallback', platform: 'pc' },
    );

    expect(stats.identity).toEqual({
      nickname: 'fallback',
      platform: 'pc',
      profileId: 'p-1',
      avatarUrl: 'https://a/b.png',
      level: 210,
    });
    expect(stats.ranked).toEqual({
      season: { id: 'Y10S3', name: 'High Stakes' },
      rank: { name: 'Champion' },
      rp: { current: 4321, max: 4400 },
      mmr: { current: 4321, peak: 4600 },
      matches: {
        wins: 120,
        losses: 80,
        winRate: 0.6,
        kills: 1500,
        deaths: 1200,
        kd: 1.25,
      },
      hsPercent: 0.5789,
      rpHistory: [
        { timestamp: 1758000000000, rp: 4200, rank: 'Diamond' },
        { timestamp: 1758100000000, rp: 4321, rank: 'Champion' },
      ],
    });
    expect(stats.casual).toEqual({
      wins: 50,
      losses: 50,
      winRate: 0.5,
      kills: 600,
      deaths: 500,
      kd: 1.2,
    });
    expect(stats.unranked).toEqual({
      wins: 8,
      losses: 4,
      winRate: 2 / 3,
      kills: 70,
      deaths: 60,
      kd: 7 / 6,
    });
  });

  it('identity 缺失时使用回退昵称与平台，未知字段不推断', () => {
    const stats = normalizeUpstreamStats({}, { nickname: 'Shaiiko', platform: 'pc' });
    expect(stats.identity).toEqual({
      nickname: 'Shaiiko',
      platform: 'pc',
      profileId: null,
      avatarUrl: null,
      level: null,
    });
    expect(stats.ranked).toBeNull();
    expect(stats.casual).toBeNull();
    expect(stats.unranked).toBeNull();
  });

  it('未知数据一律置 null，禁止填零（核心回归）', () => {
    const stats = normalizeUpstreamStats(
      {
        ranked: {
          seasonId: 'Y10S3',
          rp: { current: 3000 },
          wins: 10,
          kills: 100,
        },
      },
      { nickname: 'n', platform: 'pc' },
    );
    expect(stats.ranked).toEqual({
      season: { id: 'Y10S3', name: null },
      rank: { name: null },
      rp: { current: 3000, max: null },
      mmr: { current: null, peak: null },
      matches: {
        wins: 10,
        losses: null,
        winRate: null,
        kills: 100,
        deaths: null,
        kd: null,
      },
      hsPercent: null,
      rpHistory: [],
    });
  });

  it('真实存在的 0 必须保留，不得误判为未知', () => {
    const stats = normalizeUpstreamStats(
      { casual: { wins: 0, losses: 2, kills: 0, deaths: 3 } },
      { nickname: 'n', platform: 'pc' },
    );
    expect(stats.casual).toEqual({
      wins: 0,
      losses: 2,
      winRate: 0,
      kills: 0,
      deaths: 3,
      kd: 0,
    });
  });

  it('真实 0 参与计算：全胜胜率为 1；除数为 0 或总场次为 0 时不产出比率', () => {
    const stats = normalizeUpstreamStats(
      { casual: { wins: 3, losses: 0, kills: 5, deaths: 0 } },
      { nickname: 'n', platform: 'pc' },
    );
    expect(stats.casual).toMatchObject({ winRate: 1, kd: null });
    const emptyTotals = normalizeUpstreamStats(
      { casual: { wins: 0, losses: 0 } },
      { nickname: 'n', platform: 'pc' },
    );
    expect(emptyTotals.casual).toMatchObject({ winRate: null });
  });

  it('字符串数值按数值口径收编，垃圾字符串置 null', () => {
    const stats = normalizeUpstreamStats(
      { ranked: { mmr: { current: '4200', peak: 'n/a' } } },
      { nickname: 'n', platform: 'pc' },
    );
    expect(stats.ranked?.mmr).toEqual({ current: 4200, peak: null });
  });

  it('当前赛季缺失时不回退历史：无 ranked 即 null，不做任何拼接', () => {
    const stats = normalizeUpstreamStats(
      { history: [{ seasonId: 'Y10S2' }], casual: { wins: 1, losses: 1 } },
      { nickname: 'n', platform: 'pc' },
    );
    expect(stats.ranked).toBeNull();
    expect(stats.casual).toMatchObject({ winRate: 0.5 });
  });
});

describe('normalizeRatio（比例口径）', () => {
  it('百分数除以 100，小数比例原样保留', () => {
    expect(normalizeRatio(57.89)).toBe(0.5789);
    expect(normalizeRatio(0.75)).toBe(0.75);
    expect(normalizeRatio(100)).toBe(1);
    expect(normalizeRatio('0.75')).toBe(0.75);
  });

  it('负数、超过 100 的输入、垃圾输入归 null，真实 0 保留', () => {
    expect(normalizeRatio(-1)).toBeNull();
    expect(normalizeRatio(150)).toBeNull();
    expect(normalizeRatio('n/a')).toBeNull();
    expect(normalizeRatio(null)).toBeNull();
    expect(normalizeRatio(0)).toBe(0);
  });
});

describe('normalizeRpHistory（RP 历史序列）', () => {
  it('元组数组逐点映射，ISO 字符串与秒级时间戳统一换算为毫秒', () => {
    const points = normalizeRpHistory([
      [1758000000, { value: 3000, metadata: { rank: 'GOLD I' } }],
      [1758100000000, { value: 3200, metadata: { rank: 'GOLD II' } }],
      ['2026-10-15T15:58:28.134+00:00', { value: 3300, metadata: { rank: 'PLATINUM II' } }],
    ]);
    expect(points).toEqual([
      { timestamp: 1758000000000, rp: 3000, rank: 'GOLD I' },
      { timestamp: 1758100000000, rp: 3200, rank: 'GOLD II' },
      { timestamp: Date.parse('2026-10-15T15:58:28.134+00:00'), rp: 3300, rank: 'PLATINUM II' },
    ]);
  });

  it('非法点跳过，缺失字段降级 null，非数组返回空列表', () => {
    const points = normalizeRpHistory([
      ['bad', { value: 1 }],
      [1758000000, 'not-object'],
      [1758000000, { metadata: { rank: 'X' } }],
      [1, { value: 2 }],
    ]);
    expect(points).toEqual([
      { timestamp: null, rp: 1, rank: null },
      { timestamp: 1758000000000, rp: null, rank: 'X' },
      { timestamp: null, rp: 2, rank: null },
    ]);
    expect(normalizeRpHistory(null)).toEqual([]);
    expect(normalizeRpHistory('nope')).toEqual([]);
  });
});

describe('normalizeCacheKey', () => {
  it('生成仅含小写字母、数字、下划线的确定性缓存键', () => {
    const key = normalizeCacheKey('pc', 'Penta.GommaPepe');
    expect(key).toMatch(/^pc_[a-z0-9]+_[a-z0-9_]+$/);
    expect(normalizeCacheKey('pc', 'Penta.GommaPepe')).toBe(key);
    expect(normalizeCacheKey('pc', 'penta.gommapepe')).toBe(key);
  });

  it('纯符号昵称仍生成合法键', () => {
    expect(normalizeCacheKey('xbox', '★★★')).toMatch(/^xbox_[a-z0-9]+_anon$/);
  });
});
