'use strict';

/**
 * stats-core：战绩归一化与上游适配的纯逻辑公共模块。
 *
 * 口径约定（改动必须同步回归用例）：
 * - RP 与 MMR 是两个独立维度，字段分开存放，互不推断；
 * - 未知数据一律置 null，禁止填零；
 * - 上游适配层只产出“当前赛季”数据，本模块不做历史赛季回退；
 * - 胜率 = wins / (wins + losses)，K/D = kills / deaths，仅在双端已知时计算。
 */

const STATS_CACHE_TTL_MS = 10 * 60 * 1000;

const PLATFORMS = ['pc', 'psn', 'xbox'];

const DEFAULT_PLATFORM = 'pc';

const NICKNAME_MAX_LENGTH = 32;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createCoreError(errCode, errMsg) {
  const error = new Error(errMsg);
  error.errCode = errCode;
  return error;
}

// 未知数据不填零：缺失、空串、非数值一律归 null；真实存在的数值（含 0）原样保留。
function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function computeWinRate(wins, losses) {
  if (wins === null || losses === null) {
    return null;
  }
  const total = wins + losses;
  return total > 0 ? wins / total : null;
}

function computeKd(kills, deaths) {
  if (kills === null || deaths === null || deaths <= 0) {
    return null;
  }
  return kills / deaths;
}

function normalizeModeStats(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const wins = toFiniteNumber(raw.wins);
  const losses = toFiniteNumber(raw.losses);
  const kills = toFiniteNumber(raw.kills);
  const deaths = toFiniteNumber(raw.deaths);
  return {
    wins,
    losses,
    winRate: computeWinRate(wins, losses),
    kills,
    deaths,
    kd: computeKd(kills, deaths),
  };
}

function normalizeIdentity(raw, fallback) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    nickname: toTrimmedString(source.nickname) ?? fallback.nickname,
    platform: toTrimmedString(source.platform) ?? fallback.platform,
    profileId: toTrimmedString(source.profileId),
    avatarUrl: toTrimmedString(source.avatarUrl),
    level: toFiniteNumber(source.level),
  };
}

function normalizeRankedSummary(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const rpSource = isPlainObject(raw.rp) ? raw.rp : {};
  const mmrSource = isPlainObject(raw.mmr) ? raw.mmr : {};
  return {
    season: {
      id: toTrimmedString(raw.seasonId),
      name: toTrimmedString(raw.seasonName),
    },
    rank: {
      name: toTrimmedString(raw.rankName),
    },
    rp: {
      current: toFiniteNumber(rpSource.current),
      max: toFiniteNumber(rpSource.max),
    },
    mmr: {
      current: toFiniteNumber(mmrSource.current),
      peak: toFiniteNumber(mmrSource.peak),
    },
    matches: normalizeModeStats({
      wins: raw.wins,
      losses: raw.losses,
      kills: raw.kills,
      deaths: raw.deaths,
    }),
  };
}

/**
 * 将上游适配层产出的原始战绩归一化为客户端展示口径。
 * raw 结构不完整时逐字段降级为 null，不抛错、不填零。
 */
function normalizeUpstreamStats(raw, fallbackIdentity) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    identity: normalizeIdentity(source.identity, fallbackIdentity),
    ranked: normalizeRankedSummary(source.ranked),
    casual: normalizeModeStats(source.casual),
  };
}

/**
 * 云对象入参校验：platform 缺省时按 PC（uplay）口径处理。
 */
function validatePlayerStatsQuery(params) {
  const source = isPlainObject(params) ? params : {};
  if (typeof source.nickname !== 'string' || source.nickname.trim() === '') {
    throw createCoreError('E_INVALID_PARAM', 'nickname 不能为空');
  }
  const nickname = source.nickname.trim();
  if (nickname.length > NICKNAME_MAX_LENGTH) {
    throw createCoreError('E_INVALID_PARAM', `nickname 长度不能超过 ${NICKNAME_MAX_LENGTH} 个字符`);
  }
  const platform =
    source.platform === undefined || source.platform === null ? DEFAULT_PLATFORM : source.platform;
  if (!PLATFORMS.includes(platform)) {
    throw createCoreError('E_INVALID_PARAM', `platform 仅支持 ${PLATFORMS.join(' / ')}`);
  }
  return { nickname, platform };
}

function hashCacheSeed(seed) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * 生成确定性缓存键，直接用作缓存集合 _id（仅含小写字母、数字、下划线）。
 */
function normalizeCacheKey(platform, nickname) {
  const normalizedNickname = nickname.trim().toLowerCase();
  const slug = normalizedNickname
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const seed = hashCacheSeed(`${platform}:${normalizedNickname}`);
  return `${platform}_${seed}_${slug === '' ? 'anon' : slug}`;
}

/**
 * 上游客户端工厂。当前上游尚未接入：凭据来源、字段口径确定前，
 * 一律返回 E_UPSTREAM_NOT_CONFIGURED，由调用方决定提示方式。
 */
function createUpstreamClient(_config) {
  return {
    async fetchPlayerStats(_query) {
      // TODO(upstream): 接入育碧数据源。会话凭据只允许存放在
      // uni-config-center（r6-upstream 插件），禁止落库、入前端或写日志。
      throw createCoreError('E_UPSTREAM_NOT_CONFIGURED', '上游数据源尚未接入');
    },
  };
}

module.exports = {
  STATS_CACHE_TTL_MS,
  PLATFORMS,
  DEFAULT_PLATFORM,
  NICKNAME_MAX_LENGTH,
  createCoreError,
  normalizeUpstreamStats,
  validatePlayerStatsQuery,
  normalizeCacheKey,
  createUpstreamClient,
};
