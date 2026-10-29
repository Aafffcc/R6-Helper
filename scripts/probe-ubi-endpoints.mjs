/**
 * 育碧官方端点联调探针：登录换 ticket → 玩家档案查找 → 对局历史端点探测。
 * 仅手动运行，不进 `npm run verify`（AGENTS.md：普通验证不调用需要真实凭据的联调脚本）：
 *
 *   node scripts/probe-ubi-endpoints.mjs [--nickname Beaulo] [--platform pc] [--limit 20]
 *
 * - 小号凭据只从 uni-config-center 的 r6-upstream/config.json 的 ubi 段读取，禁止硬编码；
 * - 端点 URL、Ubi-AppId、query 参数均为社区已知口径的候选值，逐个实测，
 *   成功组合以脱敏 fixture 落盘 scripts/fixtures/ubi/，作为适配器实现与测试依据；
 * - 输出与落盘一律脱敏（ticket/sessionId/凭据绝不打印或写入文件）。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const upstreamConfigPath = join(
  projectRoot,
  'uniCloud-alipay',
  'cloudfunctions',
  'common',
  'uni-config-center',
  'r6-upstream',
  'config.json',
);
const fixtureDir = join(projectRoot, 'scripts', 'fixtures', 'ubi');

const AUTH_BASE_URL = 'https://public-ubiservices.ubi.com';
const API_BASE_URL = 'https://api.r6.ubi.com';
const REQUEST_TIMEOUT_MS = 15000;

// Ubi-AppId 候选：R6S 各社区封装使用的取值不一，实测哪个能通过校验后写回 config
const APP_ID_CANDIDATES = [
  '63314fb6-d744-46ad-8bea-7153abea7f46',
  'e0503fce-4f53-4f86-a8bf-899a4378654b',
  '39ba9ad389f84b0395da3b1dcaeaa16c',
];

// 育碧 titleId/spaceId 社区已知口径（PC/PSN/XBOX 三平台）
const SPACE_IDS = {
  pc: '5172a89f-5015-47fb-a719-d9b30b22d780',
  psn: '05bfbde8-51d1-474c-a5fd-9e39bd075b4a',
  xbox: '0ee5bcc4-6d59-4969-b9e5-e151ec679b3e',
};

const PLATFORM_TYPE_BY_APP = { pc: 'uplay', psn: 'psn', xbox: 'xbl' };

const SENSITIVE_KEY_PATTERN = /(ticket|session|password|email|authorization)/i;

function fail(message) {
  console.error(`[probe-ubi] ${message}`);
  process.exitCode = 1;
}

function readUpstreamConfig() {
  let raw;
  try {
    raw = readFileSync(upstreamConfigPath, 'utf8');
  } catch {
    fail(`缺少上游配置：${upstreamConfigPath}（ubi 凭据填入本文件 ubi 段，真实文件已 gitignore）`);
    return null;
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    fail(`上游配置解析失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const ubi = typeof config.ubi === 'object' && config.ubi !== null ? config.ubi : {};
  const email = typeof ubi.email === 'string' ? ubi.email.trim() : '';
  const password = typeof ubi.password === 'string' ? ubi.password : '';
  const appId = typeof ubi.appId === 'string' && ubi.appId.trim() !== '' ? ubi.appId.trim() : null;
  if (email === '' || password === '') {
    fail('ubi.email / ubi.password 为空：请先在 r6-upstream/config.json 填入专用小号凭据');
    return null;
  }
  // 用户配置了 appId 时置于候选首位；其余候选仍会兜底尝试
  const candidates =
    appId !== null ? [appId, ...APP_ID_CANDIDATES.filter((id) => id !== appId)] : APP_ID_CANDIDATES;
  return { email, password, appIds: [...new Set(candidates)] };
}

function readArgs(argv) {
  const args = { nickname: 'Beaulo', platform: 'pc', limit: 20 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--nickname' && argv[i + 1]) {
      args.nickname = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--platform' && argv[i + 1]) {
      args.platform = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--limit' && argv[i + 1]) {
      args.limit = Number.parseInt(argv[i + 1], 10) || 20;
      i += 1;
    }
  }
  if (!(args.platform in SPACE_IDS)) {
    fail(`--platform 仅支持 ${Object.keys(SPACE_IDS).join(' / ')}`);
    return null;
  }
  return args;
}

/** 深拷贝并把敏感键替换为占位符，fixture 落盘前必须过这道处理 */
function sanitize(value) {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (typeof value === 'object' && value !== null) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitize(entry);
    }
    return result;
  }
  return value;
}

async function requestJson(url, headers, label) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.log(`  [${label}] 网络失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  console.log(`  [${label}] HTTP ${response.status}${body === null ? '（响应非 JSON）' : ''}`);
  return { status: response.status, ok: response.ok, body };
}

function authHeaders(appId, ticket) {
  const headers = { 'Ubi-AppId': appId, Accept: 'application/json' };
  if (ticket !== null) {
    headers.Authorization = `Ubi_v1 t=${ticket}`;
  }
  return headers;
}

async function probeLogin(email, password, appIds) {
  console.log('\n== 步骤 1/3：登录探测（候选 Ubi-AppId 逐个尝试）');
  const basic = Buffer.from(`${email}:${password}`).toString('base64');
  const headers = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  for (const appId of appIds) {
    console.log(`  Ubi-AppId=${appId}`);
    const result = await requestJson(`${AUTH_BASE_URL}/v3/login`, headers, 'login');
    if (result === null) {
      continue;
    }
    const body = result.body;
    if (result.ok && body !== null && typeof body.ticket === 'string' && body.ticket !== '') {
      const expiration =
        typeof body.expiration === 'string' ? body.expiration : String(body.expiration ?? '');
      console.log(`  登录成功：expiration=${expiration}`);
      return { appId, ticket: body.ticket, sessionId: body.sessionId ?? null, expiration };
    }
    if (result.status === 401 || result.status === 403) {
      fail('登录被拒绝（401/403）：凭据错误，或该账号被 Ubisoft 风控。请核对小号邮箱密码。');
      return null;
    }
    if (result.status === 409 || result.status === 423) {
      fail(
        '登录被拦截（409/423）：大概率触发了验证码/2FA 风控。请稍后重试、换网络出口，或在 Ubisoft 账号安全设置里为新设备放行。',
      );
      return null;
    }
  }
  fail('所有候选 Ubi-AppId 均未登录成功');
  return null;
}

async function probeProfile(session, platformType, nickname) {
  console.log('\n== 步骤 2/3：玩家档案查找');
  const url = `${API_BASE_URL}/v3/profiles?nameOnPlatform=${encodeURIComponent(nickname)}&platformType=${platformType}`;
  const result = await requestJson(url, authHeaders(session.appId, session.ticket), 'profiles');
  if (result === null) {
    return null;
  }
  if (result.status === 404) {
    fail(`玩家 ${nickname}（${platformType}）不存在，换一个确定存在的玩家名重试`);
    return null;
  }
  if (result.status === 401 || result.status === 403) {
    fail('档案查找被拒（401/403）：ticket 未被接受，记录该 AppId 组合并反馈。');
    return null;
  }
  const profiles = result.body?.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    fail(`档案响应结构异常：${JSON.stringify(sanitize(result.body)).slice(0, 300)}`);
    return null;
  }
  const profile = profiles[0];
  console.log(
    `  找到玩家：nameOnPlatform=${profile.nameOnPlatform} profileId=${profile.profileId} platformType=${profile.platformType}`,
  );
  return profile;
}

function buildMatchUrlCandidates(spaceId, profileId, limit) {
  const base = `${API_BASE_URL}/v1/spaces/${spaceId}/titles/r6s/players/${profileId}`;
  return [
    { label: 'matches', url: `${base}/matches?limit=${limit}` },
    { label: 'matchhistory', url: `${base}/matchhistory?limit=${limit}` },
  ];
}

async function probeMatches(session, spaceId, profileId, limit) {
  console.log('\n== 步骤 3/3：对局历史端点探测');
  for (const candidate of buildMatchUrlCandidates(spaceId, profileId, limit)) {
    const result = await requestJson(
      candidate.url,
      authHeaders(session.appId, session.ticket),
      candidate.label,
    );
    if (result === null || !result.ok) {
      continue;
    }
    const matches = result.body?.matches;
    console.log(
      `  端点 ${candidate.label} 可用：matches 数量=${Array.isArray(matches) ? matches.length : '非数组'}`,
    );
    if (Array.isArray(matches) && matches.length > 0) {
      const first = matches[0];
      console.log(`  首场对局顶层字段：${Object.keys(first).join(', ')}`);
      const players = first.players;
      if (Array.isArray(players)) {
        console.log(
          `  首场 players 数量=${players.length}，单玩家字段：${Object.keys(players[0]).join(', ')}`,
        );
      } else {
        console.log('  首场不含 players 数组');
      }
    }
    return result.body;
  }
  fail('两个候选对局端点均不可用：请把上方各端点的 HTTP 状态回报，用于校正端点候选清单');
  return null;
}

function summarize(body) {
  if (typeof body !== 'object' || body === null) {
    return {};
  }
  const matches = Array.isArray(body.matches) ? body.matches : [];
  const first = matches[0];
  if (typeof first !== 'object' || first === null) {
    return { matchesCount: matches.length };
  }
  return {
    matchesCount: matches.length,
    firstMatchKeys: Object.keys(first),
    playersCount: Array.isArray(first.players) ? first.players.length : null,
    firstPlayerKeys:
      Array.isArray(first.players) &&
      typeof first.players[0] === 'object' &&
      first.players[0] !== null
        ? Object.keys(first.players[0])
        : null,
  };
}

async function main() {
  console.log('[probe-ubi] 育碧官方端点联调探针（凭据只从 uni-config-center 读取，输出已脱敏）');
  const config = readUpstreamConfig();
  if (config === null) {
    return;
  }
  const args = readArgs(process.argv.slice(2));
  if (args === null) {
    return;
  }

  const session = await probeLogin(config.email, config.password, config.appIds);
  if (session === null) {
    return;
  }
  const profile = await probeProfile(session, PLATFORM_TYPE_BY_APP[args.platform], args.nickname);
  if (profile === null) {
    return;
  }
  const payload = await probeMatches(
    session,
    SPACE_IDS[args.platform],
    profile.profileId,
    args.limit,
  );
  if (payload === null) {
    return;
  }

  mkdirSync(fixtureDir, { recursive: true });
  const sessionFixture = {
    appId: session.appId,
    expiration: session.expiration,
    platform: args.platform,
    spaceId: SPACE_IDS[args.platform],
    probedAt: new Date().toISOString(),
  };
  writeFileSync(join(fixtureDir, 'session.json'), `${JSON.stringify(sessionFixture, null, 2)}\n`);
  writeFileSync(
    join(fixtureDir, 'profile.json'),
    `${JSON.stringify(sanitize(profile), null, 2)}\n`,
  );
  writeFileSync(
    join(fixtureDir, 'matches.json'),
    `${JSON.stringify(sanitize(payload), null, 2)}\n`,
  );
  console.log('\n== 探测完成');
  console.log(`  可用 Ubi-AppId：${session.appId}（请写回 config.json 的 ubi.appId 固定下来）`);
  console.log(`  fixture 已写入：${fixtureDir}{session,profile,matches}.json`);
  console.log(`  摘要：${JSON.stringify(summarize(payload))}`);
}

await main();
