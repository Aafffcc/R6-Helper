import { describe, expect, it } from 'vitest';

import { createArenyzeClient, createUpstreamClient, normalizeUpstreamStats } from '../index';
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
      rank: { name: 'PLATINUM II' },
      rp: { current: 3300, max: 3450 },
      mmr: { current: null, peak: null },
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
        { timestamp: Date.parse('2026-10-15T15:58:28.134+00:00'), rp: 3000, rank: 'GOLD I' },
        { timestamp: Date.parse('2026-10-16T15:58:28.134+00:00'), rp: 3300, rank: 'PLATINUM II' },
      ],
    });
    expect(stats.casual).toMatchObject({ wins: 50, losses: 50, kd: 1.2 });
    expect(stats.unranked).toMatchObject({ wins: 10, losses: 10, kd: 0.9 });
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
