import { describe, expect, it } from 'vitest';

import {
  MATCHES_PAGE_SIZE,
  UBI_APP_ID_DEFAULT,
  UBI_AUTH_BASE_URL,
  UBI_SPACE_IDS,
  createUbiClient,
  createUpstreamClient,
  validatePlayerMatchesQuery,
} from '../index';

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

/** 依序弹出手写响应序列的 recording fetch，用于断言“先登录后数据”的重试链路 */
function createScriptedFetch(responses: unknown[]) {
  const calls: RecordedCall[] = [];
  let cursor = 0;
  const fetchImpl = async (input: unknown, init: unknown) => {
    calls.push({ input, init });
    const next = cursor < responses.length ? responses[cursor] : responses[responses.length - 1];
    cursor += 1;
    return typeof next === 'function' ? (next as () => unknown)() : next;
  };
  return { fetchImpl, calls };
}

function createMemorySessionStore(initial: unknown = null) {
  const state = { session: initial };
  return {
    state,
    loadSession: async () => state.session,
    saveSession: async (session: unknown) => {
      state.session = session;
    },
  };
}

/** 社区已知口径的登录响应形状（ticket/expiration 字段名为探针校准前的母本） */
function buildLoginPayload(ticket = 'TICKET_1', withExpiration = true) {
  return {
    platformId: 'UPLAY',
    profileId: 'prof-1',
    ticket,
    sessionId: 'sess-1',
    ...(withExpiration ? { expiration: '2026-10-29T12:00:00.000Z' } : {}),
    spaceId: 'space-1',
  };
}

function buildProfilesPayload() {
  return {
    profiles: [
      {
        profileId: 'pid-1',
        userId: 'uid-1',
        platformType: 'uplay',
        idOnPlatform: '1',
        nameOnPlatform: 'Beaulo',
      },
    ],
  };
}

function buildMatchesPayload() {
  return {
    matches: [
      {
        id: 'match-001',
        matchType: 'ranked',
        map: 'BANK',
        roundsWon: 7,
        roundsLost: 2,
        players: [
          { profileId: 'other-1', stats: { kills: 3, deaths: 9, assists: 1 } },
          {
            profileId: 'pid-1',
            stats: { kills: 12, deaths: 4, assists: 3 },
            skillStats: { current: 3200, change: 25 },
          },
        ],
        completedAt: '2026-10-28T20:30:00.000Z',
        duration: 2100,
      },
    ],
  };
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function readHeaders(call: RecordedCall): Record<string, string> {
  const init = call.init as { headers?: Record<string, string>; method?: string };
  return init.headers ?? {};
}

function readMethod(call: RecordedCall): string {
  return (call.init as { method?: string }).method ?? 'GET';
}

const UBI_QUERY = { nickname: 'Beaulo', platform: 'pc' as const };

describe('createUbiClient（育碧官方上游适配）', () => {
  it('凭据缺失：email/password 为空时 E_UPSTREAM_NOT_CONFIGURED，不发任何请求', () => {
    const { fetchImpl, calls } = createScriptedFetch([]);
    expect(() => createUbiClient({ email: '  ', password: 'pw' }, { fetchImpl })).toThrowError(
      expect.objectContaining({ errCode: 'E_UPSTREAM_NOT_CONFIGURED' }),
    );
    expect(() => createUbiClient({ email: 'a@b.c', password: '' }, { fetchImpl })).toThrowError(
      expect.objectContaining({ errCode: 'E_UPSTREAM_NOT_CONFIGURED' }),
    );
    expect(calls).toHaveLength(0);
  });

  it('请求链路：先 POST 登录（Basic + Ubi-AppId）→ 档案查找 → 对局请求命中 pc spaceId', async () => {
    const { fetchImpl, calls } = createScriptedFetch([
      jsonResponse(200, buildLoginPayload()),
      jsonResponse(200, buildProfilesPayload()),
      jsonResponse(200, buildMatchesPayload()),
    ]);
    const store = createMemorySessionStore();
    const client = createUbiClient(
      { email: 'acc@example.com', password: 'pw-secret' },
      { fetchImpl, loadSession: store.loadSession, saveSession: store.saveSession },
    );

    await client.fetchPlayerMatches(UBI_QUERY);

    expect(calls).toHaveLength(3);
    expect(String(calls[0].input)).toBe(`${UBI_AUTH_BASE_URL}/v3/login`);
    expect(readMethod(calls[0])).toBe('POST');
    expect(readHeaders(calls[0]).Authorization).toBe(
      `Basic ${base64('acc@example.com:pw-secret')}`,
    );
    expect(readHeaders(calls[0])['Ubi-AppId']).toBe(UBI_APP_ID_DEFAULT);
    expect(readHeaders(calls[0])['Content-Type']).toBe('application/json');

    expect(String(calls[1].input)).toContain('/v3/profiles?nameOnPlatform=Beaulo');
    expect(String(calls[1].input)).toContain('platformType=uplay');
    expect(readHeaders(calls[1]).Authorization).toBe('Ubi_v1 t=TICKET_1');
    expect(readHeaders(calls[1])['Ubi-AppId']).toBe(UBI_APP_ID_DEFAULT);

    expect(String(calls[2].input)).toContain(
      `/v1/spaces/${UBI_SPACE_IDS.pc}/titles/r6s/players/pid-1/matches`,
    );
    const matchesUrl = new URL(String(calls[2].input));
    expect(matchesUrl.searchParams.get('limit')).toBe(String(MATCHES_PAGE_SIZE));
    expect(matchesUrl.searchParams.get('beforeDate')).toBeNull();
  });

  it('新鲜 session 直接复用：不再登录，后续请求使用存量 ticket', async () => {
    const { fetchImpl, calls } = createScriptedFetch([
      jsonResponse(200, buildProfilesPayload()),
      jsonResponse(200, buildMatchesPayload()),
    ]);
    const store = createMemorySessionStore({
      ticket: 'STORED_TICKET',
      sessionId: 'sess-0',
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const client = createUbiClient(
      { email: 'acc@example.com', password: 'pw-secret' },
      { fetchImpl, loadSession: store.loadSession, saveSession: store.saveSession },
    );

    await client.fetchPlayerMatches(UBI_QUERY);

    expect(calls).toHaveLength(2);
    expect(readHeaders(calls[0]).Authorization).toBe('Ubi_v1 t=STORED_TICKET');
  });

  it('过期 session 触发重登并回写 store，expiration 缺失时按 UBI_SESSION_TTL_MS 兜底', async () => {
    const { fetchImpl, calls } = createScriptedFetch([
      jsonResponse(200, buildLoginPayload('TICKET_2', false)),
      jsonResponse(200, buildProfilesPayload()),
      jsonResponse(200, buildMatchesPayload()),
    ]);
    const store = createMemorySessionStore({
      ticket: 'OLD_TICKET',
      sessionId: null,
      expiresAt: Date.now() - 1000,
    });
    const client = createUbiClient(
      { email: 'acc@example.com', password: 'pw-secret' },
      { fetchImpl, loadSession: store.loadSession, saveSession: store.saveSession },
    );

    await client.fetchPlayerMatches(UBI_QUERY);

    expect(String(calls[0].input)).toBe(`${UBI_AUTH_BASE_URL}/v3/login`);
    expect(readHeaders(calls[1]).Authorization).toBe('Ubi_v1 t=TICKET_2');
    const saved = store.state.session as { ticket: string; expiresAt: number };
    expect(saved.ticket).toBe('TICKET_2');
    const margin = 60 * 1000;
    expect(saved.expiresAt).toBeGreaterThan(Date.now() + 30 * 60 * 1000 - margin);
    expect(saved.expiresAt).toBeLessThanOrEqual(Date.now() + 55 * 60 * 1000 + margin);
  });

  it('对局请求 401：强制重登一次后重试成功，重试请求携带新 ticket', async () => {
    const { fetchImpl, calls } = createScriptedFetch([
      jsonResponse(401, { httpCode: 401 }),
      jsonResponse(200, buildLoginPayload('TICKET_REFRESHED')),
      jsonResponse(200, buildMatchesPayload()),
    ]);
    const store = createMemorySessionStore({
      ticket: 'STORED_TICKET',
      sessionId: null,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const client = createUbiClient(
      { email: 'acc@example.com', password: 'pw-secret' },
      { fetchImpl, loadSession: store.loadSession, saveSession: store.saveSession },
    );

    // 传入已缓存的 profileId：跳过档案查找，精确断言“对局 401 → 重登 → 重试”链路
    await client.fetchPlayerMatches({ ...UBI_QUERY, profileId: 'pid-1' });

    expect(calls).toHaveLength(3);
    expect(String(calls[0].input)).toContain('/matches');
    expect(String(calls[1].input)).toBe(`${UBI_AUTH_BASE_URL}/v3/login`);
    expect(String(calls[2].input)).toContain('/matches');
    expect(readHeaders(calls[2]).Authorization).toBe('Ubi_v1 t=TICKET_REFRESHED');
    expect((store.state.session as { ticket: string }).ticket).toBe('TICKET_REFRESHED');
  });

  it('对局请求重试后仍 401：E_UPSTREAM_AUTH', async () => {
    const { fetchImpl } = createScriptedFetch([
      jsonResponse(401, {}),
      jsonResponse(200, buildLoginPayload()),
      jsonResponse(401, {}),
    ]);
    const store = createMemorySessionStore({
      ticket: 'STORED_TICKET',
      sessionId: null,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const client = createUbiClient(
      { email: 'acc@example.com', password: 'pw-secret' },
      { fetchImpl, loadSession: store.loadSession, saveSession: store.saveSession },
    );
    await expect(
      client.fetchPlayerMatches({ ...UBI_QUERY, profileId: 'pid-1' }),
    ).rejects.toMatchObject({ errCode: 'E_UPSTREAM_AUTH' });
  });

  it('状态映射：429 → E_RATE_LIMITED，404 → E_NOT_FOUND', async () => {
    const store = createMemorySessionStore({
      ticket: 'STORED_TICKET',
      sessionId: null,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const rateLimited = createScriptedFetch([
      jsonResponse(200, buildProfilesPayload()),
      jsonResponse(429, {}),
    ]);
    const client1 = createUbiClient(
      { email: 'acc@example.com', password: 'pw' },
      {
        fetchImpl: rateLimited.fetchImpl,
        loadSession: store.loadSession,
        saveSession: store.saveSession,
      },
    );
    await expect(client1.fetchPlayerMatches(UBI_QUERY)).rejects.toMatchObject({
      errCode: 'E_RATE_LIMITED',
    });

    const notFound = createScriptedFetch([jsonResponse(404, {})]);
    const client2 = createUbiClient(
      { email: 'acc@example.com', password: 'pw' },
      {
        fetchImpl: notFound.fetchImpl,
        loadSession: store.loadSession,
        saveSession: store.saveSession,
      },
    );
    // 档案查找 404：玩家不存在
    await expect(client2.fetchPlayerMatches(UBI_QUERY)).rejects.toMatchObject({
      errCode: 'E_NOT_FOUND',
    });
  });

  it('登录失败映射：401/403 凭据拒绝、409/423 风控拦截，均为 E_UPSTREAM_AUTH', async () => {
    for (const status of [401, 403, 409, 423]) {
      const { fetchImpl } = createScriptedFetch([jsonResponse(status, {})]);
      const store = createMemorySessionStore();
      const client = createUbiClient(
        { email: 'acc@example.com', password: 'pw' },
        { fetchImpl, loadSession: store.loadSession, saveSession: store.saveSession },
      );
      await expect(client.fetchPlayerMatches(UBI_QUERY)).rejects.toMatchObject({
        errCode: 'E_UPSTREAM_AUTH',
      });
    }
  });

  it('before 游标：转为 beforeDate ISO 参数参与对局请求', async () => {
    const { fetchImpl, calls } = createScriptedFetch([
      jsonResponse(200, buildLoginPayload()),
      jsonResponse(200, buildProfilesPayload()),
      jsonResponse(200, buildMatchesPayload()),
    ]);
    const store = createMemorySessionStore();
    const client = createUbiClient(
      { email: 'acc@example.com', password: 'pw-secret' },
      { fetchImpl, loadSession: store.loadSession, saveSession: store.saveSession },
    );
    const before = 1760000000000;
    await client.fetchPlayerMatches({ ...UBI_QUERY, before });

    const matchesUrl = new URL(String(calls[2].input));
    expect(matchesUrl.searchParams.get('beforeDate')).toBe(new Date(before).toISOString());
  });
});

describe('createUpstreamClient（ubi 段分发）', () => {
  it('provider=arenyze 且配置 ubi 段：stats/operators 走 arenyze，matches 走育碧', async () => {
    const { fetchImpl, calls } = createScriptedFetch([
      jsonResponse(200, { player: { nameOnPlatform: 'Beaulo', platformType: 'uplay' } }),
      jsonResponse(200, buildLoginPayload()),
      jsonResponse(200, buildProfilesPayload()),
      jsonResponse(200, buildMatchesPayload()),
    ]);
    const client = createUpstreamClient(
      {
        provider: 'arenyze',
        apiKey: 'test-key',
        fetchImpl,
        ubi: { email: 'acc@example.com', password: 'pw-secret' },
      },
      createMemorySessionStore(),
    );
    await client.fetchPlayerStats({ nickname: 'Beaulo', platform: 'pc' });
    expect(String(calls[0].input)).toContain('/v2/profile');

    await client.fetchPlayerMatches(UBI_QUERY);
    expect(String(calls[1].input)).toBe(`${UBI_AUTH_BASE_URL}/v3/login`);
    expect(String(calls[calls.length - 1].input)).toContain('/matches');
  });

  it('缺 ubi 段：fetchPlayerMatches 降级 E_UPSTREAM_NOT_CONFIGURED，stats 语义不变', async () => {
    const { fetchImpl } = createScriptedFetch([]);
    const configured = createUpstreamClient(
      { provider: 'arenyze', apiKey: 'test-key', fetchImpl },
      createMemorySessionStore(),
    );
    await expect(configured.fetchPlayerMatches(UBI_QUERY)).rejects.toMatchObject({
      errCode: 'E_UPSTREAM_NOT_CONFIGURED',
    });

    const empty = createUpstreamClient(null, createMemorySessionStore());
    await expect(empty.fetchPlayerMatches(UBI_QUERY)).rejects.toMatchObject({
      errCode: 'E_UPSTREAM_NOT_CONFIGURED',
    });
    await expect(empty.fetchPlayerStats(UBI_QUERY)).rejects.toMatchObject({
      errCode: 'E_UPSTREAM_NOT_CONFIGURED',
    });
  });

  it('ubi 段凭据为空串：与缺段同等降级，不抛构造错误', async () => {
    const { fetchImpl } = createScriptedFetch([]);
    const client = createUpstreamClient(
      {
        provider: 'arenyze',
        apiKey: 'test-key',
        fetchImpl,
        ubi: { email: '   ', password: '' },
      },
      createMemorySessionStore(),
    );
    await expect(client.fetchPlayerMatches(UBI_QUERY)).rejects.toMatchObject({
      errCode: 'E_UPSTREAM_NOT_CONFIGURED',
    });
  });
});

describe('validatePlayerMatchesQuery（对局查询入参）', () => {
  it('platform 缺省按 pc，before 缺省为 null', () => {
    expect(validatePlayerMatchesQuery({ nickname: 'Beaulo' })).toEqual({
      nickname: 'Beaulo',
      platform: 'pc',
      before: null,
    });
  });

  it('before 必须为正整数毫秒：非整数/负数/零均为 E_INVALID_PARAM', () => {
    expect(validatePlayerMatchesQuery({ nickname: 'Beaulo', before: 1760000000000 })).toMatchObject(
      {
        before: 1760000000000,
      },
    );
    for (const before of [0, -1, 1.5, 'abc', '']) {
      expect(() => validatePlayerMatchesQuery({ nickname: 'Beaulo', before })).toThrowError(
        expect.objectContaining({ errCode: 'E_INVALID_PARAM' }),
      );
    }
  });

  it('继承主查询校验：nickname 为空抛 E_INVALID_PARAM', () => {
    expect(() => validatePlayerMatchesQuery({ nickname: '  ' })).toThrowError(
      expect.objectContaining({ errCode: 'E_INVALID_PARAM' }),
    );
  });
});
