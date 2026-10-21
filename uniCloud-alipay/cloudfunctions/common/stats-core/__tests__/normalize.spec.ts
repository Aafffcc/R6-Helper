import { describe, expect, it } from 'vitest';

import { normalizeCacheKey, normalizeUpstreamStats, validatePlayerStatsQuery } from '../index';

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
        },
        casual: { wins: 50, losses: 50, kills: 600, deaths: 500 },
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
    });
    expect(stats.casual).toEqual({
      wins: 50,
      losses: 50,
      winRate: 0.5,
      kills: 600,
      deaths: 500,
      kd: 1.2,
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
