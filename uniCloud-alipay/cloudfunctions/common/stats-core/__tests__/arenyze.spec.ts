import { describe, expect, it } from 'vitest';

import {
  createArenyzeClient,
  createUpstreamClient,
  normalizeOperatorStats,
  normalizeUpstreamStats,
} from '../index';
import type { NormalizedPlayerStats } from '../index';

interface RecordedCall {
  input: unknown;
  init: unknown;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function createRecordingFetch(response: unknown) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: unknown, init: unknown) => {
    calls.push({ input, init });
    if (typeof response === 'function') {
      return (response as () => unknown)();
    }
    return response;
  };
  return { fetchImpl, calls };
}

/** 按 arenyze 文档示例结构构造的 /v2/profile 响应（字段名为文档确认口径） */
function buildProfilePayload() {
  return {
    player: { nameOnPlatform: 'Beaulo', platformType: 'uplay', platformFamilies: 'pc' },
    account: { level: 312, profilePicture: 'https://avatars.ubisoft.com/beaulo.png' },
    banned: { isBanned: false, banAlerts: [] },
    stats: {
      platform_families_full_profiles: [
        {
          board_ids_full_profiles: [
            {
              board_id: 'ranked',
              full_profiles: [
                {
                  profile: {
                    rank: 18,
                    rank_points: 3300,
                    max_rank: 19,
                    max_rank_points: 3450,
                    wins: 120,
                    losses: 80,
                    kills: 1500,
                    deaths: 1200,
                    headshotPercent: 57.89,
                  },
                },
              ],
            },
            {
              board_id: 'casual',
              full_profiles: [{ profile: { wins: 50, losses: 50, kills: 600, deaths: 500 } }],
            },
            {
              board_id: 'standard',
              full_profiles: [{ profile: { wins: 10, losses: 10, kills: 90, deaths: 100 } }],
            },
          ],
        },
      ],
    },
    seasons: { data: { metadata: { id: 'Y11S3', name: 'Y11S3' }, segments: [] } },
    history: {
      data: {
        history: {
          // 实测口径：时间戳为 ISO 8601 字符串，且按新→旧排序
          data: [
            ['2026-10-16T15:58:28.134+00:00', { value: 3300, metadata: { rank: 'PLATINUM II' } }],
            ['2026-10-15T15:58:28.134+00:00', { value: 3000, metadata: { rank: 'GOLD I' } }],
          ],
        },
      },
    },
    meta: { included: ['stats', 'account', 'banned', 'seasons', 'history'], partial: false },
  };
}

async function fetchNormalized(payload: unknown): Promise<NormalizedPlayerStats> {
  const { fetchImpl } = createRecordingFetch(jsonResponse(200, payload));
  const client = createArenyzeClient({ apiKey: 'test-key' }, fetchImpl);
  const raw = await client.fetchPlayerStats({ nickname: 'Beaulo', platform: 'pc' });
  // 归一化必须走统一入口：适配器只产出 raw，展示口径由 normalizeUpstreamStats 决定
  return normalizeUpstreamStats(raw, { nickname: 'Beaulo', platform: 'pc' });
}

describe('createArenyzeClient（arenyze 上游适配）', () => {
  it('请求构造：GET /v2/profile 带 api-key 头，平台映射 pc→uplay、xbox→xbl', async () => {
    const { fetchImpl, calls } = createRecordingFetch(jsonResponse(200, buildProfilePayload()));
    const client = createArenyzeClient({ apiKey: 'test-key' }, fetchImpl);

    await client.fetchPlayerStats({ nickname: 'Beaulo', platform: 'pc' });
    await client.fetchPlayerStats({ nickname: 'Shaiiko', platform: 'xbox' });

    expect(calls).toHaveLength(2);
    expect(String(calls[0].input)).toContain(
      '/v2/profile?nameOnPlatform=Beaulo&platformType=uplay',
    );
    expect(String(calls[1].input)).toContain('platformType=xbl');
    const headers = calls[0].init as { headers: Record<string, string> };
    expect(headers.headers['api-key']).toBe('test-key');
  });

  it('完整响应归一化：榜单、RP 历史、段位名、爆头率、身份字段逐项落位', async () => {
    const stats = await fetchNormalized(buildProfilePayload());

    expect(stats.identity).toEqual({
      nickname: 'Beaulo',
      platform: 'pc',
      profileId: null,
      avatarUrl: 'https://avatars.ubisoft.com/beaulo.png',
      level: 312,
    });
    expect(stats.ranked).toEqual({
      season: { id: 'Y11S3', name: 'Y11S3' },
      // RP 历史 3300 (PLATINUM II) > 3000 (GOLD I)，赛季最高段位取高点段位名
      rank: { name: 'PLATINUM II', max: 'PLATINUM II' },
      rp: { current: 3300, max: 3450 },
      mmr: { current: null, peak: null },
      matches: {
        wins: 120,
        losses: 80,
        winRate: 0.6,
        kills: 1500,
        deaths: 1200,
        kd: 1.25,
        hsPercent: 0.5789,
      },
      hsPercent: 0.5789,
      rpHistory: [
        { timestamp: Date.parse('2026-10-15T15:58:28.134+00:00'), rp: 3000, rank: 'GOLD I' },
        { timestamp: Date.parse('2026-10-16T15:58:28.134+00:00'), rp: 3300, rank: 'PLATINUM II' },
      ],
    });
    expect(stats.casual).toMatchObject({ wins: 50, losses: 50, kd: 1.2 });
    expect(stats.unranked).toMatchObject({ wins: 10, losses: 10, kd: 0.9 });
    expect(stats.event).toBeNull();
    // 榜单档响应不带 seasons 分段，赛季历史为空列表
    expect(stats.seasonHistory).toEqual([]);
  });

  it('seasons 分段：赛季历史逐赛季落位（多地区取场次最多），event 从当前赛季分段读取', async () => {
    const stats = await fetchNormalized({
      player: { nameOnPlatform: 'Beaulo', platformType: 'uplay' },
      account: {},
      stats: {},
      seasons: {
        data: {
          metadata: { currentSeason: 43 },
          segments: [
            {
              attributes: { season: 43, gamemode: 'pvp_ranked' },
              metadata: { name: 'Split Fire', shortName: 'Y11S3', rank: 'PLATINUM V' },
              stats: {
                matchesPlayed: { value: 65 },
                wins: { value: 29 },
                losses: { value: 30 },
                kills: { value: 311 },
                deaths: { value: 230 },
                rankPoints: { value: 2971 },
                maxRankPoints: { value: 3009 },
              },
            },
            {
              // 同赛季另一地区分段：场次更少，不参与赛季历史汇总
              attributes: { season: 43, gamemode: 'pvp_ranked' },
              metadata: { shortName: 'Y11S3' },
              stats: {
                matchesPlayed: { value: 5 },
                wins: { value: 3 },
                losses: { value: 2 },
                kills: { value: 30 },
                deaths: { value: 20 },
                rankPoints: { value: 2500 },
              },
            },
            {
              attributes: { season: 42, gamemode: 'pvp_ranked' },
              metadata: { name: 'System Override', shortName: 'Y11S2', rank: 'PLATINUM IV' },
              stats: {
                matchesPlayed: { value: 127 },
                wins: { value: 64 },
                losses: { value: 58 },
                kills: { value: 684 },
                deaths: { value: 620 },
                rankPoints: { value: 3134 },
                maxRankPoints: { value: 3200 },
              },
            },
            {
              // 历史赛季 casual 分段：赛季历史只收排位，不收录
              attributes: { season: 42, gamemode: 'pvp_casual' },
              metadata: { shortName: 'Y11S2' },
              stats: { matchesPlayed: { value: 999 }, wins: { value: 50 }, losses: { value: 40 } },
            },
            {
              attributes: { season: 43, gamemode: 'pvp_event' },
              metadata: { name: 'Contested Gatherings' },
              stats: {
                wins: { value: 4 },
                losses: { value: 6 },
                kills: { value: 20 },
                deaths: { value: 25 },
              },
            },
          ],
        },
      },
    });

    expect(stats.seasonHistory).toEqual([
      {
        seasonNumber: 42,
        seasonId: 'Y11S2',
        seasonName: 'System Override',
        finalRankName: 'PLATINUM IV',
        finalRp: 3134,
        maxRp: 3200,
        matches: {
          wins: 64,
          losses: 58,
          winRate: 64 / 122,
          kills: 684,
          deaths: 620,
          kd: 684 / 620,
          hsPercent: null,
        },
      },
    ]);
    expect(stats.event).toMatchObject({ wins: 4, losses: 6, kd: 0.8 });
  });

  it('operators 端点：GET /v2/operators?modes=all，条目归一并按回合数降序', async () => {
    const { fetchImpl, calls } = createRecordingFetch(
      jsonResponse(200, {
        player: { nameOnPlatform: 'Beaulo', platformType: 'uplay' },
        operators: {
          seasonYear: 'Y11S3',
          operators: [
            {
              operator: 'Zofia',
              side: 'Attacker',
              roundsPlayed: 22,
              wins: 9,
              losses: 13,
              winPercent: 40.9,
              kills: 25,
              deaths: 15,
              kd: 1.67,
              headshotPercent: 41.2,
            },
            {
              operator: 'Wamai',
              side: 'Defender',
              roundsPlayed: 30,
              kills: 18,
              deaths: 14,
              headshotPercent: 20,
            },
            { roundsPlayed: 10 },
          ],
        },
      }),
    );
    const client = createArenyzeClient({ apiKey: 'test-key' }, fetchImpl);
    const raw = await client.fetchPlayerOperators({ nickname: 'Beaulo', platform: 'pc' });

    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toContain(
      '/v2/operators?nameOnPlatform=Beaulo&platformType=uplay&modes=all',
    );
    const headers = calls[0].init as { headers: Record<string, string> };
    expect(headers.headers['api-key']).toBe('test-key');

    const operators = normalizeOperatorStats(raw);
    expect(operators.map((item) => item.name)).toEqual(['Wamai', 'Zofia']);
    expect(operators[0]).toEqual({
      name: 'Wamai',
      side: 'Defender',
      rounds: 30,
      wins: null,
      losses: null,
      winRate: null,
      kills: 18,
      deaths: 14,
      kd: 18 / 14,
      hsPercent: 0.2,
    });
    expect(operators[1]).toMatchObject({
      name: 'Zofia',
      winRate: 0.409,
      kd: 1.67,
      hsPercent: 41.2 / 100,
    });
  });

  it('无榜单时从当前赛季 pvp_ranked 分段兜底，历史赛季分段不回退', async () => {
    // 实测口径：分段统计为 {value} 包装，胜负字段为 matchesWon/matchesLost，
    // segments 含全部历史赛季，须按 currentSeason 过滤
    const stats = await fetchNormalized({
      player: { nameOnPlatform: 'Beaulo', platformType: 'uplay' },
      account: {},
      stats: {},
      seasons: {
        data: {
          metadata: { currentSeason: 43 },
          segments: [
            {
              type: 'season',
              attributes: { season: 43, gamemode: 'pvp_ranked', sessionType: 'ranked' },
              metadata: { name: 'Split Fire', shortName: 'Y11S3', seasonName: 'Split Fire' },
              stats: {
                kills: { value: 40 },
                deaths: { value: 50 },
                matchesWon: { value: 5 },
                matchesLost: { value: 5 },
                rankPoints: { value: 5100 },
                maxRankPoints: { value: 5200 },
              },
            },
            {
              type: 'season',
              attributes: { season: 43, gamemode: 'pvp_casual' },
              metadata: { name: 'Split Fire' },
              stats: {
                kills: { value: 300 },
                deaths: { value: 250 },
                matchesWon: { value: 30 },
                matchesLost: { value: 20 },
              },
            },
            {
              // 上一赛季的 casual 分段：存在更早的匹配项，但绝不允许回退
              type: 'season',
              attributes: { season: 42, gamemode: 'pvp_casual' },
              metadata: { name: 'System Override' },
              stats: {
                kills: { value: 9999 },
                deaths: { value: 1 },
                matchesWon: { value: 99 },
                matchesLost: { value: 1 },
              },
            },
          ],
        },
      },
    });

    expect(stats.ranked).toMatchObject({
      season: { id: '43', name: 'Split Fire' },
      rank: { name: null },
      rp: { current: 5100, max: 5200 },
      matches: { wins: 5, losses: 5, winRate: 0.5, kd: 0.8 },
      rpHistory: [],
    });
    expect(stats.casual).toMatchObject({ wins: 30, losses: 20, kd: 1.2 });
    expect(stats.unranked).toBeNull();
    // 往赛季是独立出口：当前 43 赛季不重复收录，42 赛季只有 casual 也不收录
    expect(stats.seasonHistory).toEqual([]);
  });

  it('currentSeason 缺失时按响应顺序取首个匹配分段', async () => {
    const stats = await fetchNormalized({
      player: { nameOnPlatform: 'Beaulo', platformType: 'uplay' },
      account: {},
      stats: {},
      seasons: {
        data: {
          metadata: {},
          segments: [
            {
              attributes: { gamemode: 'pvp_casual' },
              metadata: { name: 'Split Fire' },
              stats: {
                kills: { value: 10 },
                deaths: { value: 20 },
                matchesWon: { value: 3 },
                matchesLost: { value: 3 },
              },
            },
          ],
        },
      },
    });
    expect(stats.casual).toMatchObject({ wins: 3, losses: 3, kd: 0.5 });
  });

  it('结构完全缺失时逐字段降级：ranked 为 null，不抛错、不填零', async () => {
    const stats = await fetchNormalized({ player: {}, account: {} });
    expect(stats.identity.nickname).toBe('Beaulo');
    expect(stats.ranked).toBeNull();
    expect(stats.casual).toBeNull();
    expect(stats.unranked).toBeNull();
    expect(stats.event).toBeNull();
    expect(stats.seasonHistory).toEqual([]);
  });

  it('HTTP 404 映射 E_NOT_FOUND，429 映射 E_RATE_LIMITED，401 映射认证失败', async () => {
    for (const [status, errCode] of [
      [404, 'E_NOT_FOUND'],
      [429, 'E_RATE_LIMITED'],
      [401, 'E_UPSTREAM_ERROR'],
    ] as const) {
      const { fetchImpl } = createRecordingFetch(jsonResponse(status, {}));
      const client = createArenyzeClient({ apiKey: 'test-key' }, fetchImpl);
      await expect(
        client.fetchPlayerStats({ nickname: 'n', platform: 'pc' }),
      ).rejects.toMatchObject({ errCode });
    }
  });

  it('网络异常与非 JSON 响应映射 E_UPSTREAM_ERROR', async () => {
    const failingFetch = async () => {
      throw new Error('ECONNRESET');
    };
    const client = createArenyzeClient({ apiKey: 'test-key' }, failingFetch);
    await expect(client.fetchPlayerStats({ nickname: 'n', platform: 'pc' })).rejects.toMatchObject({
      errCode: 'E_UPSTREAM_ERROR',
    });

    const badJson = createRecordingFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token');
      },
    });
    const client2 = createArenyzeClient({ apiKey: 'test-key' }, badJson.fetchImpl);
    await expect(client2.fetchPlayerStats({ nickname: 'n', platform: 'pc' })).rejects.toMatchObject(
      { errCode: 'E_UPSTREAM_ERROR' },
    );
  });

  it('apiKey 缺失时抛 E_UPSTREAM_NOT_CONFIGURED', () => {
    expect(() => createArenyzeClient({ apiKey: '  ' }, async () => ({}))).toThrowError(/apiKey/);
    expect(() => createArenyzeClient({}, async () => ({}))).toThrowError(/apiKey/);
  });
});

describe('createUpstreamClient（上游分发）', () => {
  it('配置缺失或 provider 未知时维持“上游未接入”降级语义', async () => {
    for (const config of [null, {}, { provider: 'unknown-source' }]) {
      const client = createUpstreamClient(config);
      await expect(
        client.fetchPlayerStats({ nickname: 'n', platform: 'pc' }),
      ).rejects.toMatchObject({ errCode: 'E_UPSTREAM_NOT_CONFIGURED' });
      await expect(
        client.fetchPlayerOperators({ nickname: 'n', platform: 'pc' }),
      ).rejects.toMatchObject({ errCode: 'E_UPSTREAM_NOT_CONFIGURED' });
    }
  });

  it('provider=arenyze 且带 key 时返回真实适配客户端', async () => {
    const { fetchImpl, calls } = createRecordingFetch(jsonResponse(200, buildProfilePayload()));
    const client = createUpstreamClient({
      provider: 'arenyze',
      apiKey: 'test-key',
      fetchImpl,
    });
    const raw = (await client.fetchPlayerStats({ nickname: 'Beaulo', platform: 'psn' })) as {
      identity: { nickname: string; platform: string };
    };
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toContain('platformType=psn');
    expect(raw.identity.nickname).toBe('Beaulo');
  });
});
