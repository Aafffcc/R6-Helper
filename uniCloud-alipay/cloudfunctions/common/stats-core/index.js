'use strict';

/**
 * stats-core：战绩归一化与上游适配的纯逻辑公共模块。
 *
 * 口径约定（改动必须同步回归用例）：
 * - RP 与 MMR 是两个独立维度，字段分开存放，互不推断；
 * - 未知数据一律置 null，禁止填零；
 * - “当前赛季”各模式（ranked/casual/unranked/event）只取当前赛季分段，不做历史回退；
 *   往赛季数据走独立的 seasonHistory 出口，只汇总、不参与当前赛季兜底；
 * - 胜率 = wins / (wins + losses)，K/D = kills / deaths，仅在双端已知时计算；
 * - 比例字段（winRate / hsPercent）统一为 0..1 口径。
 */

const STATS_CACHE_TTL_MS = 10 * 60 * 1000;

// 干员聚合统计变化慢于实时战绩，独立使用更长的缓存有效期以节省上游配额
const OPERATORS_CACHE_TTL_MS = 30 * 60 * 1000;

const PLATFORMS = ['pc', 'psn', 'xbox'];

const DEFAULT_PLATFORM = 'pc';

const NICKNAME_MAX_LENGTH = 32;

// RP 历史点数上限：保护缓存文档体积，超出时保留最近的数据点
const RP_HISTORY_MAX_POINTS = 500;

const ARENYZE_DEFAULT_BASE_URL = 'https://public-api.arenyze.com/r6/api';
const ARENYZE_REQUEST_TIMEOUT_MS = 15 * 1000;

// 应用侧平台 → arenyze platformType 口径
const ARENYZE_PLATFORM_BY_APP = { pc: 'uplay', psn: 'psn', xbox: 'xbl' };
// arenyze platformType → 应用侧平台，用于 identity 回填
const APP_PLATFORM_BY_ARENYZE = { uplay: 'pc', psn: 'psn', xbl: 'xbox' };

/* ------------------------------------------------------------------ *
 * 育碧官方上游（对局历史）常量。
 * 端点与取值为社区已知口径，scripts/probe-ubi-endpoints.mjs 联调后
 * 如有出入，以探针报告为准修订，并把可用 Ubi-AppId 固定进 config.ubi.appId。
 * ------------------------------------------------------------------ */

const UBI_AUTH_BASE_URL = 'https://public-ubiservices.ubi.com';
const UBI_API_BASE_URL = 'https://api.r6.ubi.com';
const UBI_APP_ID_DEFAULT = '63314fb6-d744-46ad-8bea-7153abea7f46';
// 育碧 titleId/spaceId（PC / PSN / XBOX）
const UBI_SPACE_IDS = {
  pc: '5172a89f-5015-47fb-a719-d9b30b22d780',
  psn: '05bfbde8-51d1-474c-a5fd-9e39bd075b4a',
  xbox: '0ee5bcc4-6d59-4969-b9e5-e151ec679b3e',
};
const UBI_REQUEST_TIMEOUT_MS = 15 * 1000;
// ticket 实际有效期约 3 小时，保守按 55 分钟复用，宁可多登一次
const UBI_SESSION_TTL_MS = 55 * 60 * 1000;
// session 剩余寿命不足该值时不复用，避免请求中途过期
const UBI_SESSION_REUSE_MARGIN_MS = 60 * 1000;

// 对局缓存与分页口径：列表页短缓存，逐场文档长缓存（对局打完即不可变）
const MATCHES_PAGE_SIZE = 20;
const MATCHES_LIST_TTL_MS = STATS_CACHE_TTL_MS;
const MATCH_TTL_MS = 180 * 24 * 60 * 60 * 1000;
// 档案查找结果（昵称 → profileId）的缓存有效期
const PLAYER_UID_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

/**
 * 比例口径归一：统一为 0..1。0..1 的小数视为比例原样保留；1..100 视为
 * 百分数（如 57.89 表示 57.89%）除以 100；超过 100 或负数视为未知归 null。
 */
function normalizeRatio(value) {
  const num = toFiniteNumber(value);
  if (num === null || num < 0 || num > 100) {
    return null;
  }
  return num > 1 ? num / 100 : num;
}

/**
 * 历史时间戳归一为毫秒。真实口径（arenyze 实测）为 ISO 8601 字符串，
 * 同时兼容毫秒（> 1e12）与秒（1e9..1e12）数值；其余归 null。
 */
function normalizeHistoryTimestamp(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  const num = toFiniteNumber(value);
  if (num === null || num <= 0) {
    return null;
  }
  if (num > 1e12) {
    return num;
  }
  if (num > 1e9) {
    return num * 1000;
  }
  return null;
}

/**
 * RP 历史归一：接受 [timestamp, { value, metadata }] 元组数组，也接受
 * 已归一的 { timestamp, rp, rank } 点对象（幂等，适配器产出会二次归一）。
 * 非法点与无数据点跳过，超出上限保留最近数据。
 */
function normalizeRpHistory(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const points = [];
  for (const entry of raw) {
    if (isPlainObject(entry)) {
      const rp = toFiniteNumber(entry.rp);
      const rank = toTrimmedString(entry.rank);
      if (rp === null && rank === null) {
        continue;
      }
      points.push({
        timestamp: normalizeHistoryTimestamp(entry.timestamp),
        rp,
        rank,
      });
      continue;
    }
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }
    const detail = isPlainObject(entry[1]) ? entry[1] : {};
    const metadata = isPlainObject(detail.metadata) ? detail.metadata : {};
    const rp = toFiniteNumber(detail.value);
    const rank = toTrimmedString(metadata.rank);
    // rp 与 rank 双缺失的点对图表无用，直接丢弃
    if (rp === null && rank === null) {
      continue;
    }
    points.push({
      timestamp: normalizeHistoryTimestamp(entry[0]),
      rp,
      rank,
    });
  }
  return points.slice(-RP_HISTORY_MAX_POINTS);
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
    // 上游未提供爆头率的模式保持 null，禁止用其他模式的口径补位
    hsPercent: normalizeRatio(raw.hsPercent),
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

/**
 * 赛季最高段位名：取 RP 历史中 RP 最高的带段位名时点。
 * 历史缺失或点名缺失时为 null，不用当前段位顶替（未知不推断）。
 */
function extractMaxRankName(points) {
  let best = null;
  for (const point of points) {
    if (point.rp === null || point.rank === null) {
      continue;
    }
    if (best === null || point.rp > best.rp) {
      best = point;
    }
  }
  return best === null ? null : best.rank;
}

function normalizeRankedSummary(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const rpSource = isPlainObject(raw.rp) ? raw.rp : {};
  const mmrSource = isPlainObject(raw.mmr) ? raw.mmr : {};
  const history = normalizeRpHistory(raw.rpHistory);
  return {
    season: {
      id: toTrimmedString(raw.seasonId),
      name: toTrimmedString(raw.seasonName),
    },
    rank: {
      name: toTrimmedString(raw.rankName),
      max: extractMaxRankName(history),
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
      hsPercent: raw.hsPercent,
    }),
    hsPercent: normalizeRatio(raw.hsPercent),
    rpHistory: history,
  };
}

/**
 * 往赛季排位历史归一：适配层产出扁平分段摘要，这里统一收敛为展示口径。
 * 排序与适配层一致（赛季号降序），缺失赛季号的记录排最后。
 */
function normalizeSeasonHistory(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const records = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      continue;
    }
    records.push({
      seasonNumber: toFiniteNumber(entry.seasonNumber),
      seasonId: toTrimmedString(entry.seasonId),
      seasonName: toTrimmedString(entry.seasonName),
      finalRankName: toTrimmedString(entry.finalRankName),
      finalRp: toFiniteNumber(entry.finalRp),
      maxRp: toFiniteNumber(entry.maxRp),
      matches: normalizeModeStats({
        wins: entry.wins,
        losses: entry.losses,
        kills: entry.kills,
        deaths: entry.deaths,
      }),
    });
  }
  return records.sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0));
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
    unranked: normalizeModeStats(source.unranked),
    event: normalizeModeStats(source.event),
    seasonHistory: normalizeSeasonHistory(source.seasonHistory),
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

/**
 * 对局查询入参校验：继承主查询口径，before 为“加载更多”游标
 * （毫秒时间戳，取上一页最早已知对局时间），缺省 null 表示首页。
 */
function validatePlayerMatchesQuery(params) {
  const base = validatePlayerStatsQuery(params);
  const source = isPlainObject(params) ? params : {};
  if (source.before === undefined || source.before === null) {
    return { ...base, before: null };
  }
  const before = toFiniteNumber(source.before);
  if (before === null || !Number.isInteger(before) || before <= 0) {
    throw createCoreError('E_INVALID_PARAM', 'before 游标必须为正整数毫秒时间戳');
  }
  return { ...base, before };
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

/* ------------------------------------------------------------------ *
 * arenyze 上游适配（v2/profile）
 *
 * 响应字段口径以 https://r6.arenyze.com/api-docs 为准；文档未展开的
 * 嵌套结构按多层回退路径抽取，全部失败时逐字段降级 null。
 * 首次真实联调后如发现结构差异，只调整本节的 extract 系列函数并补回归用例。
 * ------------------------------------------------------------------ */

function collectBoardProfiles(payload) {
  // 遍历 stats.platform_families_full_profiles 下的所有榜单档位档案，
  // 兼容 board_ids_full_profiles 中间层存在或缺省两种嵌套。
  const result = [];
  const families = payload?.stats?.platform_families_full_profiles;
  if (!Array.isArray(families)) {
    return result;
  }
  for (const family of families) {
    if (!isPlainObject(family)) {
      continue;
    }
    const boardGroups = Array.isArray(family.board_ids_full_profiles)
      ? family.board_ids_full_profiles
      : [family];
    for (const board of boardGroups) {
      if (!isPlainObject(board) || !Array.isArray(board.full_profiles)) {
        continue;
      }
      const boardId = toTrimmedString(board.board_id) ?? '';
      for (const item of board.full_profiles) {
        if (isPlainObject(item) && isPlainObject(item.profile)) {
          result.push({ boardId, profile: item.profile });
        }
      }
    }
  }
  return result;
}

function pickBoardProfile(collected, match) {
  const hit = collected.find((entry) => match(entry.boardId.toLowerCase()));
  return hit ? hit.profile : null;
}

function extractRpHistory(payload) {
  const rawHistory = payload?.history?.data?.history?.data;
  const points = normalizeRpHistory(Array.isArray(rawHistory) ? rawHistory : []);
  // 实测上游按新→旧排序，契约统一为时间升序（图表最新点在最右）
  return [...points].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

/** seasons.data.metadata.currentSeason（实测为数字，如 43），缺失归 null */
function findCurrentSeasonNumber(payload) {
  return toFiniteNumber(payload?.seasons?.data?.metadata?.currentSeason);
}

/**
 * 实测口径：segments 含全部历史赛季（attributes.season + gamemode），
 * 统计字段是 { value } 包装且胜负字段名为 matchesWon / matchesLost。
 * 只匹配当前赛季分段，遵守“不回退历史”口径；currentSeason 缺失时
 * 退回首个匹配（响应按新赛季在前排序）。
 */
function findSeasonSegment(payload, gamemode) {
  const segments = payload?.seasons?.data?.segments;
  if (!Array.isArray(segments)) {
    return null;
  }
  const currentSeason = findCurrentSeasonNumber(payload);
  if (currentSeason !== null) {
    for (const segment of segments) {
      if (!isPlainObject(segment) || !isPlainObject(segment.stats)) {
        continue;
      }
      const season = toFiniteNumber(segment.attributes?.season);
      if (segment.attributes?.gamemode === gamemode && season === currentSeason) {
        return segment;
      }
    }
    return null;
  }
  for (const segment of segments) {
    if (
      isPlainObject(segment) &&
      isPlainObject(segment.stats) &&
      segment.attributes?.gamemode === gamemode
    ) {
      return segment;
    }
  }
  return null;
}

/** 分段统计读取：兼容 { value } 包装与裸数值，按候选字段名依次取值 */
function readSegmentStat(stats, keys) {
  for (const key of keys) {
    const entry = stats[key];
    const value = isPlainObject(entry) ? toFiniteNumber(entry.value) : toFiniteNumber(entry);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function extractSeasonId(payload) {
  const metadata = payload?.seasons?.data?.metadata;
  const id = toTrimmedString(metadata?.id);
  if (id !== null) {
    return id;
  }
  const currentSeason = findCurrentSeasonNumber(payload);
  return currentSeason !== null ? String(currentSeason) : null;
}

function extractSeasonName(payload) {
  const rankedSegment = findSeasonSegment(payload, 'pvp_ranked');
  const seasonData = payload?.seasons?.data;
  const candidates = [
    rankedSegment?.metadata?.seasonName,
    rankedSegment?.metadata?.name,
    seasonData?.metadata?.name,
    seasonData?.metadata?.seasonName,
    Array.isArray(seasonData?.segments) ? seasonData.segments[0]?.metadata?.name : null,
  ];
  for (const candidate of candidates) {
    const name = toTrimmedString(candidate);
    if (name !== null) {
      return name;
    }
  }
  return null;
}

function extractRankedFromProfile(payload) {
  const collected = collectBoardProfiles(payload);
  const board = pickBoardProfile(
    collected,
    (boardId) => boardId.includes('ranked') && !boardId.includes('unrank'),
  );
  const history = extractRpHistory(payload);
  // arenyze 榜单档案里 rank 是数字段位 ID；当前段位名取 RP 历史最新点名
  let rankName = null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].rank !== null) {
      rankName = history[i].rank;
      break;
    }
  }
  if (board === null) {
    // 榜单缺失时从当前赛季 pvp_ranked 分段兜底（实测统计为 {value} 包装）
    const segment = findSeasonSegment(payload, 'pvp_ranked');
    if (segment === null) {
      return null;
    }
    const segmentStats = segment.stats;
    return {
      seasonId: extractSeasonId(payload),
      seasonName: extractSeasonName(payload),
      rankName: toTrimmedString(segment.metadata?.rank),
      rp: {
        current: readSegmentStat(segmentStats, ['rankPoints', 'rank_points']),
        max: readSegmentStat(segmentStats, ['maxRankPoints', 'max_rank_points']),
      },
      // arenyze profile 不提供 MMR：独立维度保持未知，不推断不填零
      mmr: { current: null, peak: null },
      wins: readSegmentStat(segmentStats, ['wins', 'matchesWon']),
      losses: readSegmentStat(segmentStats, ['losses', 'matchesLost']),
      kills: readSegmentStat(segmentStats, ['kills']),
      deaths: readSegmentStat(segmentStats, ['deaths']),
      hsPercent: readSegmentStat(segmentStats, ['headshotPercent', 'headshot_percent']),
      rpHistory: [],
    };
  }
  return {
    seasonId: extractSeasonId(payload),
    seasonName: extractSeasonName(payload),
    rankName,
    rp: {
      current: toFiniteNumber(board.rank_points),
      max: toFiniteNumber(board.max_rank_points),
    },
    wins: toFiniteNumber(board.wins),
    losses: toFiniteNumber(board.losses),
    kills: toFiniteNumber(board.kills),
    deaths: toFiniteNumber(board.deaths),
    hsPercent: toFiniteNumber(board.headshotPercent),
    rpHistory: history,
  };
}

function extractModeFromSegments(payload, gamemode) {
  const segment = findSeasonSegment(payload, gamemode);
  if (segment === null) {
    return null;
  }
  const segmentStats = segment.stats;
  return normalizeModeStats({
    wins: readSegmentStat(segmentStats, ['wins', 'matchesWon']),
    losses: readSegmentStat(segmentStats, ['losses', 'matchesLost']),
    kills: readSegmentStat(segmentStats, ['kills']),
    deaths: readSegmentStat(segmentStats, ['deaths']),
    hsPercent: readSegmentStat(segmentStats, ['headshotPercent', 'headshot_percent']),
  });
}

/** season 编号 → YxxSx 标签（Y1S1 = 1，Y11S3 = 43；仅上游 shortName 缺失时的兜底） */
function composeSeasonLabel(seasonNumber) {
  if (seasonNumber === null || seasonNumber < 1) {
    return null;
  }
  const year = Math.ceil(seasonNumber / 4);
  const seasonInYear = seasonNumber - (year - 1) * 4;
  return `Y${year}S${seasonInYear}`;
}

/**
 * 往赛季排位历史摘要（扁平口径，展示结构由 normalizeSeasonHistory 收敛）：
 * seasons.segments 含全部历史赛季；同一赛季可能存在多地区分段，
 * 取场次数最多的分段作为代表，不做跨段加总；排除当前赛季，只收录出现过
 * 排位分段的往赛季，按赛季号降序（最新在前）。
 */
function extractSeasonHistory(payload) {
  const segments = payload?.seasons?.data?.segments;
  if (!Array.isArray(segments)) {
    return [];
  }
  const currentSeason = findCurrentSeasonNumber(payload);
  const pickedBySeason = new Map();
  for (const segment of segments) {
    if (!isPlainObject(segment) || !isPlainObject(segment.stats)) {
      continue;
    }
    if (segment.attributes?.gamemode !== 'pvp_ranked') {
      continue;
    }
    const seasonNumber = toFiniteNumber(segment.attributes?.season);
    if (seasonNumber === null || seasonNumber === currentSeason) {
      continue;
    }
    const matchesPlayed = readSegmentStat(segment.stats, ['matchesPlayed', 'matches_played']) ?? 0;
    const picked = pickedBySeason.get(seasonNumber);
    if (picked === undefined || matchesPlayed > picked.matchesPlayed) {
      pickedBySeason.set(seasonNumber, { segment, matchesPlayed });
    }
  }
  const records = [];
  for (const [seasonNumber, picked] of pickedBySeason) {
    const segment = picked.segment;
    const metadata = isPlainObject(segment.metadata) ? segment.metadata : {};
    const label = toTrimmedString(metadata.shortName) ?? composeSeasonLabel(seasonNumber);
    const name = toTrimmedString(metadata.seasonName) ?? toTrimmedString(metadata.name);
    records.push({
      seasonNumber,
      seasonId: label,
      // 名称与标签同值（如上游 name 也填 Y10S4）时不重复展示
      seasonName: name !== null && name !== label ? name : null,
      finalRankName: toTrimmedString(metadata.rank),
      finalRp: readSegmentStat(segment.stats, ['rankPoints', 'rank_points']),
      maxRp: readSegmentStat(segment.stats, ['maxRankPoints', 'max_rank_points']),
      wins: readSegmentStat(segment.stats, ['wins', 'matchesWon']),
      losses: readSegmentStat(segment.stats, ['losses', 'matchesLost']),
      kills: readSegmentStat(segment.stats, ['kills']),
      deaths: readSegmentStat(segment.stats, ['deaths']),
    });
  }
  return records.sort((a, b) => b.seasonNumber - a.seasonNumber);
}

/* ------------------------------------------------------------------ *
 * arenyze 干员统计适配（v2/operators）
 *
 * 文档示例只确认 operator/side/roundsPlayed/kd/kills/deaths 字段，
 * 其余字段（wins/losses/winPercent/headshotPercent 等）按 v1 同模型
 * 口径多层回退读取；缺名称的条目丢弃，其余字段缺失逐项降级 null。
 * ------------------------------------------------------------------ */

function extractOperatorEntries(payload) {
  const source = payload?.operators;
  if (Array.isArray(source)) {
    return source;
  }
  if (isPlainObject(source) && Array.isArray(source.operators)) {
    return source.operators;
  }
  return [];
}

function normalizeOperatorEntry(entry) {
  const name = toTrimmedString(entry.operator) ?? toTrimmedString(entry.name);
  if (name === null) {
    return null;
  }
  const wins = toFiniteNumber(entry.wins);
  const losses = toFiniteNumber(entry.losses);
  const kills = toFiniteNumber(entry.kills);
  const deaths = toFiniteNumber(entry.deaths);
  return {
    name,
    side: toTrimmedString(entry.side),
    rounds: toFiniteNumber(entry.roundsPlayed) ?? toFiniteNumber(entry.rounds),
    wins,
    losses,
    winRate: normalizeRatio(entry.winPercent) ?? computeWinRate(wins, losses),
    kills,
    deaths,
    kd: toFiniteNumber(entry.kd) ?? computeKd(kills, deaths),
    hsPercent: normalizeRatio(entry.headshotPercent),
  };
}

/**
 * 干员列表归一：按出场回合数降序（未知排最后），同回合数按名称排序保证稳定。
 */
function normalizeOperatorStats(raw) {
  const source = Array.isArray(raw) ? raw : extractOperatorEntries(raw);
  const operators = [];
  for (const entry of source) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const normalized = normalizeOperatorEntry(entry);
    if (normalized !== null) {
      operators.push(normalized);
    }
  }
  return operators.sort((a, b) => {
    const roundsA = a.rounds ?? -1;
    const roundsB = b.rounds ?? -1;
    if (roundsA !== roundsB) {
      return roundsB - roundsA;
    }
    return a.name.localeCompare(b.name);
  });
}

function extractIdentityFromProfile(payload, query) {
  const player = isPlainObject(payload.player) ? payload.player : {};
  const account = isPlainObject(payload.account) ? payload.account : {};
  const platformType = toTrimmedString(player.platformType);
  return {
    nickname: toTrimmedString(player.nameOnPlatform) ?? query.nickname,
    // identity.platform 是应用侧口径，arenyze 的 uplay/xbl 需映射回来
    platform: (platformType !== null && APP_PLATFORM_BY_ARENYZE[platformType]) || query.platform,
    profileId: toTrimmedString(player.profileId),
    avatarUrl: toTrimmedString(account.profilePicture),
    level: toFiniteNumber(account.level),
  };
}

function buildRawStatsFromProfile(payload, query) {
  if (!isPlainObject(payload)) {
    throw createCoreError('E_UPSTREAM_ERROR', '上游响应结构异常：非对象');
  }
  const collected = collectBoardProfiles(payload);
  const casualBoard = pickBoardProfile(collected, (boardId) => boardId.includes('casual'));
  const unrankedBoard = pickBoardProfile(
    collected,
    (boardId) => boardId.includes('standard') || boardId.includes('unrank'),
  );
  return {
    identity: extractIdentityFromProfile(payload, query),
    ranked: extractRankedFromProfile(payload),
    casual:
      casualBoard !== null
        ? normalizeModeStats({
            wins: casualBoard.wins,
            losses: casualBoard.losses,
            kills: casualBoard.kills,
            deaths: casualBoard.deaths,
            hsPercent: casualBoard.headshotPercent,
          })
        : extractModeFromSegments(payload, 'pvp_casual'),
    unranked:
      unrankedBoard !== null
        ? normalizeModeStats({
            wins: unrankedBoard.wins,
            losses: unrankedBoard.losses,
            kills: unrankedBoard.kills,
            deaths: unrankedBoard.deaths,
            hsPercent: unrankedBoard.headshotPercent,
          })
        : extractModeFromSegments(payload, 'pvp_standard'),
    // event 模式无榜单口径，只能从当前赛季 pvp_event 分段取，缺失为 null
    event: extractModeFromSegments(payload, 'pvp_event'),
    seasonHistory: extractSeasonHistory(payload),
  };
}

/**
 * arenyze 上游客户端。fetchImpl 供测试注入；生产使用运行时全局 fetch
 * （云函数 Node 18+ 运行时）。apiKey 只经 config 传入，禁止落日志。
 */
function createArenyzeClient(config, fetchImpl) {
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (apiKey === '') {
    throw createCoreError('E_UPSTREAM_NOT_CONFIGURED', 'arenyze apiKey 未配置');
  }
  const baseUrl =
    typeof config.baseUrl === 'string' && config.baseUrl.trim() !== ''
      ? config.baseUrl.trim().replace(/\/+$/, '')
      : ARENYZE_DEFAULT_BASE_URL;
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw createCoreError('E_UPSTREAM_NOT_CONFIGURED', '当前运行时不支持 fetch，无法访问上游');
  }

  async function requestJson(pathname, query) {
    const url = new URL(`${baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const timeoutSignal =
      typeof AbortSignal === 'object' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(ARENYZE_REQUEST_TIMEOUT_MS)
        : undefined;
    let response;
    try {
      response = await doFetch(url, { headers: { 'api-key': apiKey }, signal: timeoutSignal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      throw createCoreError('E_UPSTREAM_ERROR', `上游网络请求失败：${reason}`);
    }
    if (response.status === 429) {
      throw createCoreError('E_RATE_LIMITED', '上游调用频率超限，请稍后再试');
    }
    if (response.status === 404) {
      throw createCoreError('E_NOT_FOUND', '玩家不存在或平台不匹配');
    }
    if (response.status === 401 || response.status === 403) {
      throw createCoreError('E_UPSTREAM_ERROR', '上游认证失败，请检查 apiKey 配置');
    }
    if (!response.ok) {
      throw createCoreError('E_UPSTREAM_ERROR', `上游响应异常：HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw createCoreError('E_UPSTREAM_ERROR', '上游响应不是合法 JSON');
    }
  }

  return {
    async fetchPlayerStats(query) {
      const payload = await requestJson('/v2/profile', {
        nameOnPlatform: query.nickname,
        platformType: ARENYZE_PLATFORM_BY_APP[query.platform] ?? query.platform,
      });
      return buildRawStatsFromProfile(payload, query);
    },
    async fetchPlayerOperators(query) {
      const payload = await requestJson('/v2/operators', {
        nameOnPlatform: query.nickname,
        platformType: ARENYZE_PLATFORM_BY_APP[query.platform] ?? query.platform,
        // 一次拉全模式聚合，控制上游调用量；seasonYear 缺省由上游按当前赛季返回
        modes: 'all',
      });
      return { operators: extractOperatorEntries(payload) };
    },
  };
}

/* ------------------------------------------------------------------ *
 * 育碧官方对局历史适配（/v1/spaces/{spaceId}/titles/r6s/players/{id}/matches）
 *
 * 端点字段名为社区已知形状（scripts/probe-ubi-endpoints.mjs 联调校准前的
 * 实现母本），联调后如发现字段差异，只调整本节候选字段名并同步
 * normalize.spec.ts fixture，NormalizedMatchSummary 展示契约保持不变。
 * ------------------------------------------------------------------ */

// 秒值远超单局可能时长（约 11 小时）时按毫秒口径换算为秒
const MATCH_DURATION_MS_THRESHOLD = 40000;

function normalizeMatchMode(value) {
  const text = toTrimmedString(value);
  if (text === null) {
    return null;
  }
  const lower = text.toLowerCase();
  // 'unranked' 同样包含 rank 关键词，非排位口径必须先判
  if (lower.includes('unrank') || lower.includes('standard')) {
    return 'unranked';
  }
  if (lower.includes('rank')) {
    return 'ranked';
  }
  if (lower.includes('casual')) {
    return 'casual';
  }
  return 'other';
}

function normalizeMatchResult(value) {
  const text = toTrimmedString(value);
  if (text === null) {
    return null;
  }
  const lower = text.toLowerCase();
  if (lower === 'win' || lower === 'won' || lower === 'victory') {
    return 'win';
  }
  if (lower === 'loss' || lower === 'lost' || lower === 'defeat') {
    return 'loss';
  }
  return null;
}

function normalizeMatchDurationSeconds(value) {
  const num = toFiniteNumber(value);
  if (num === null || num < 0) {
    return null;
  }
  return num > MATCH_DURATION_MS_THRESHOLD ? Math.round(num / 1000) : num;
}

/** 取查询玩家本人的分段；profileId 未命中或缺失时退回首个玩家分段 */
function pickMatchPlayerSegment(entry, profileId) {
  const players = entry.players;
  if (!Array.isArray(players)) {
    return null;
  }
  if (profileId !== null) {
    for (const candidate of players) {
      if (isPlainObject(candidate) && toTrimmedString(candidate.profileId) === profileId) {
        return candidate;
      }
    }
  }
  for (const candidate of players) {
    if (isPlainObject(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeMatchEntry(entry, context) {
  const id = toTrimmedString(entry.id ?? entry.matchId ?? entry._id);
  if (id === null) {
    return null;
  }
  const mode = normalizeMatchMode(entry.matchType ?? entry.gameMode ?? entry.mode);
  const roundsWon = toFiniteNumber(entry.roundsWon ?? entry.round_score_win);
  const roundsLost = toFiniteNumber(entry.roundsLost ?? entry.round_score_lose);
  let result = normalizeMatchResult(entry.roundResult ?? entry.result);
  if (result === null && roundsWon !== null && roundsLost !== null && roundsWon !== roundsLost) {
    result = roundsWon > roundsLost ? 'win' : 'loss';
  }
  const player = pickMatchPlayerSegment(entry, context.profileId);
  const stats = player !== null && isPlainObject(player.stats) ? player.stats : {};
  const skill = player !== null && isPlainObject(player.skillStats) ? player.skillStats : {};
  // RP 口径仅排位对局保留，非排位对局不推断
  const rankedOnly = mode === 'ranked';
  return {
    id,
    platform: context.platform,
    mode,
    map: toTrimmedString(entry.map ?? entry.mapName ?? entry.world),
    result,
    roundsWon,
    roundsLost,
    kills: toFiniteNumber(stats.kills),
    deaths: toFiniteNumber(stats.deaths),
    assists: toFiniteNumber(stats.assists),
    rpChange: rankedOnly ? toFiniteNumber(skill.change ?? skill.rpChange) : null,
    rpAfter: rankedOnly ? toFiniteNumber(skill.current ?? skill.rpAfter ?? skill.newRp) : null,
    playedAt: normalizeHistoryTimestamp(
      entry.completedAt ?? entry.endTime ?? entry.endedAt ?? entry.startedAt ?? entry.timestamp,
    ),
    durationSeconds: normalizeMatchDurationSeconds(
      entry.duration ?? entry.matchDuration ?? entry.durationInSeconds,
    ),
  };
}

/**
 * 对局列表归一：按 playedAt 降序（未知排最后），重复 id 只保留首个，
 * oldestPlayedAt 取页内最早已知时间，作为“加载更多”的 before 游标。
 */
function normalizeUbiMatches(raw, context) {
  const sourceContext = isPlainObject(context) ? context : {};
  const platform = toTrimmedString(sourceContext.platform) ?? DEFAULT_PLATFORM;
  const profileId = toTrimmedString(sourceContext.profileId);
  const source = Array.isArray(raw)
    ? raw
    : isPlainObject(raw) && Array.isArray(raw.matches)
      ? raw.matches
      : [];
  const seen = new Set();
  const matches = [];
  for (const entry of source) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const normalized = normalizeMatchEntry(entry, { platform, profileId });
    if (normalized === null || seen.has(normalized.id)) {
      continue;
    }
    seen.add(normalized.id);
    matches.push(normalized);
  }
  matches.sort(
    (a, b) => (b.playedAt ?? Number.NEGATIVE_INFINITY) - (a.playedAt ?? Number.NEGATIVE_INFINITY),
  );
  let oldestPlayedAt = null;
  for (const match of matches) {
    if (match.playedAt !== null && (oldestPlayedAt === null || match.playedAt < oldestPlayedAt)) {
      oldestPlayedAt = match.playedAt;
    }
  }
  return { matches, oldestPlayedAt };
}

/**
 * 育碧官方上游客户端（登录 → 档案查找 → 对局历史）。
 *
 * 会话生命周期通过 deps 注入：生产由云对象提供落库实现（跨请求复用 ticket，
 * 遵守“进程级缓存不可靠”纪律），测试注入内存实现，模块保持无状态。
 * 凭据只经 config 传入，禁止落日志。Buffer 为 Node 运行时全局，
 * 本模块只被云函数与测试环境加载。
 */
function createUbiClient(config, deps) {
  const email = typeof config.email === 'string' ? config.email.trim() : '';
  const password = typeof config.password === 'string' ? config.password : '';
  if (email === '' || password === '') {
    throw createCoreError('E_UPSTREAM_NOT_CONFIGURED', 'ubi 小号凭据未配置');
  }
  const appId =
    typeof config.appId === 'string' && config.appId.trim() !== ''
      ? config.appId.trim()
      : UBI_APP_ID_DEFAULT;
  const authBaseUrl = resolveUpstreamBaseUrl(config.authBaseUrl, UBI_AUTH_BASE_URL);
  const apiBaseUrl = resolveUpstreamBaseUrl(config.apiBaseUrl, UBI_API_BASE_URL);
  const source = isPlainObject(deps) ? deps : {};
  const doFetch = typeof source.fetchImpl === 'function' ? source.fetchImpl : globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw createCoreError('E_UPSTREAM_NOT_CONFIGURED', '当前运行时不支持 fetch，无法访问上游');
  }
  const loadSession =
    typeof source.loadSession === 'function' ? source.loadSession : async () => null;
  const saveSession =
    typeof source.saveSession === 'function' ? source.saveSession : async () => {};

  async function doRequest(url, headers, method) {
    const timeoutSignal =
      typeof AbortSignal === 'object' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(UBI_REQUEST_TIMEOUT_MS)
        : undefined;
    let response;
    try {
      response = await doFetch(url, { method, headers, signal: timeoutSignal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      throw createCoreError('E_UPSTREAM_ERROR', `育碧上游网络请求失败：${reason}`);
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok === true, status: response.status, body };
  }

  function isUsableSession(session) {
    return (
      isPlainObject(session) &&
      typeof session.ticket === 'string' &&
      session.ticket !== '' &&
      typeof session.expiresAt === 'number' &&
      session.expiresAt > Date.now() + UBI_SESSION_REUSE_MARGIN_MS
    );
  }

  /**
   * 登录换取 ticket。401/403 为凭据拒绝，409/423 为风控拦截
   * （验证码/两步验证），二者都按 E_UPSTREAM_AUTH 收敛，由展示层提示。
   */
  async function login() {
    const basic = Buffer.from(`${email}:${password}`).toString('base64');
    const { ok, status, body } = await doRequest(
      `${authBaseUrl}/v3/login`,
      {
        Authorization: `Basic ${basic}`,
        'Ubi-AppId': appId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      'POST',
    );
    if (status === 401 || status === 403) {
      throw createCoreError('E_UPSTREAM_AUTH', '育碧登录被拒绝：请检查专用小号凭据');
    }
    if (status === 409 || status === 423) {
      throw createCoreError('E_UPSTREAM_AUTH', '育碧登录被风控拦截（验证码/两步验证），请稍后重试');
    }
    if (status === 429) {
      throw createCoreError('E_RATE_LIMITED', '育碧登录频率超限，请稍后再试');
    }
    if (!ok || !isPlainObject(body) || toTrimmedString(body.ticket) === null) {
      throw createCoreError('E_UPSTREAM_ERROR', `育碧登录响应异常：HTTP ${status}`);
    }
    const session = {
      ticket: toTrimmedString(body.ticket) ?? '',
      sessionId: toTrimmedString(body.sessionId),
      expiresAt: normalizeHistoryTimestamp(body.expiration) ?? Date.now() + UBI_SESSION_TTL_MS,
    };
    await saveSession(session);
    return session;
  }

  async function ensureSession(force) {
    if (force !== true) {
      const stored = await loadSession();
      if (isUsableSession(stored)) {
        return stored;
      }
    }
    return login();
  }

  function ticketedHeaders(ticket) {
    return {
      Authorization: `Ubi_v1 t=${ticket}`,
      'Ubi-AppId': appId,
      Accept: 'application/json',
    };
  }

  async function lookupProfile(nickname, platform) {
    const session = await ensureSession(false);
    const platformType = ARENYZE_PLATFORM_BY_APP[platform] ?? platform;
    const url = new URL(`${apiBaseUrl}/v3/profiles`);
    url.searchParams.set('nameOnPlatform', nickname);
    url.searchParams.set('platformType', platformType);
    const { ok, status, body } = await doRequest(
      String(url),
      ticketedHeaders(session.ticket),
      'GET',
    );
    if (status === 404) {
      throw createCoreError('E_NOT_FOUND', '玩家不存在或平台不匹配');
    }
    if (status === 401 || status === 403) {
      throw createCoreError('E_UPSTREAM_AUTH', '育碧会话被拒绝：ticket 失效或 AppId 不匹配');
    }
    if (status === 429) {
      throw createCoreError('E_RATE_LIMITED', '育碧调用频率超限，请稍后再试');
    }
    if (!ok || !isPlainObject(body) || !Array.isArray(body.profiles)) {
      throw createCoreError('E_UPSTREAM_ERROR', `育碧档案响应异常：HTTP ${status}`);
    }
    for (const entry of body.profiles) {
      if (isPlainObject(entry) && toTrimmedString(entry.profileId) !== null) {
        return toTrimmedString(entry.profileId) ?? '';
      }
    }
    throw createCoreError('E_UPSTREAM_ERROR', '育碧档案响应缺少 profileId');
  }

  function buildMatchesUrl(platform, profileId, before) {
    const spaceId = UBI_SPACE_IDS[platform];
    if (typeof spaceId !== 'string') {
      throw createCoreError(
        'E_INVALID_PARAM',
        `platform 仅支持 ${Object.keys(UBI_SPACE_IDS).join(' / ')}`,
      );
    }
    const url = new URL(
      `${apiBaseUrl}/v1/spaces/${spaceId}/titles/r6s/players/${encodeURIComponent(profileId)}/matches`,
    );
    url.searchParams.set('limit', String(MATCHES_PAGE_SIZE));
    if (before !== null && before !== undefined) {
      // 分页参数名为社区口径，探针联调后如需修订只改此处
      url.searchParams.set('beforeDate', new Date(before).toISOString());
    }
    return String(url);
  }

  async function fetchPlayerMatches(query) {
    const source = isPlainObject(query) ? query : {};
    const nickname = toTrimmedString(source.nickname);
    const platform = toTrimmedString(source.platform);
    if (nickname === null || platform === null) {
      throw createCoreError('E_INVALID_PARAM', 'nickname / platform 不能为空');
    }
    const before = toFiniteNumber(source.before);
    const session = await ensureSession(false);
    let profileId = toTrimmedString(source.profileId);
    if (profileId === null) {
      profileId = await lookupProfile(nickname, platform);
    }
    let response = await doRequest(
      buildMatchesUrl(platform, profileId, before),
      ticketedHeaders(session.ticket),
      'GET',
    );
    if (response.status === 401 || response.status === 403) {
      // ticket 中途失效：强制重登一次再试，仍被拒绝才按认证错误收敛
      const refreshed = await ensureSession(true);
      response = await doRequest(
        buildMatchesUrl(platform, profileId, before),
        ticketedHeaders(refreshed.ticket),
        'GET',
      );
      if (response.status === 401 || response.status === 403) {
        throw createCoreError('E_UPSTREAM_AUTH', '育碧会话失效且重新登录后仍被拒绝');
      }
    }
    if (response.status === 429) {
      throw createCoreError('E_RATE_LIMITED', '育碧调用频率超限，请稍后再试');
    }
    if (response.status === 404) {
      throw createCoreError('E_NOT_FOUND', '玩家对局数据不存在');
    }
    if (!response.ok) {
      throw createCoreError('E_UPSTREAM_ERROR', `育碧对局响应异常：HTTP ${response.status}`);
    }
    if (!isPlainObject(response.body)) {
      throw createCoreError('E_UPSTREAM_ERROR', '育碧对局响应不是合法 JSON');
    }
    return response.body;
  }

  return { login, ensureSession, lookupProfile, fetchPlayerMatches };
}

/** 上游 baseUrl 兜底：非空字符串裁掉尾部斜杠，否则用默认值 */
function resolveUpstreamBaseUrl(value, fallback) {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim().replace(/\/+$/, '');
  }
  return fallback;
}

/** 读取 config.ubi 段并收敛为客户端凭据结构；缺失或凭据为空返回 null */
function readUbiCredentials(config) {
  const section = isPlainObject(config.ubi) ? config.ubi : {};
  const email = typeof section.email === 'string' ? section.email.trim() : '';
  const password = typeof section.password === 'string' ? section.password : '';
  if (email === '' || password === '') {
    return null;
  }
  const appId =
    typeof section.appId === 'string' && section.appId.trim() !== ''
      ? section.appId.trim()
      : undefined;
  return { email, password, appId };
}

/**
 * 上游客户端工厂：按 uni-config-center 的 r6-upstream 配置分发。
 * stats/operators 跟随 provider（当前 arenyze）；matches 跟随 ubi 段凭据，
 * 两条链路独立降级（E_UPSTREAM_NOT_CONFIGURED），互不影响。
 * sessionStore 为育碧会话落库回调（loadSession/saveSession），由云对象注入。
 * config.fetchImpl 仅作测试注入点，真实配置来自 JSON，不会带函数。
 */
function createUpstreamClient(config, sessionStore) {
  const source = isPlainObject(config) ? config : {};
  const store = isPlainObject(sessionStore) ? sessionStore : {};
  const ubiCredentials = readUbiCredentials(source);
  const ubiClient =
    ubiCredentials !== null
      ? createUbiClient(ubiCredentials, {
          fetchImpl: source.fetchImpl,
          loadSession: store.loadSession,
          saveSession: store.saveSession,
        })
      : null;

  async function fetchPlayerMatches(query) {
    if (ubiClient === null) {
      throw createCoreError('E_UPSTREAM_NOT_CONFIGURED', 'ubi 对局凭据未配置');
    }
    return ubiClient.fetchPlayerMatches(query);
  }

  if (source.provider === 'arenyze') {
    const arenyzeClient = createArenyzeClient(source, source.fetchImpl);
    return {
      async fetchPlayerStats(query) {
        return arenyzeClient.fetchPlayerStats(query);
      },
      async fetchPlayerOperators(query) {
        return arenyzeClient.fetchPlayerOperators(query);
      },
      fetchPlayerMatches,
    };
  }
  return {
    async fetchPlayerStats(_query) {
      // TODO(upstream): 接入其他数据源时在此扩展 provider 分发。会话凭据
      // 只允许存放在 uni-config-center（r6-upstream 插件），禁止落库、入前端或写日志。
      throw createCoreError('E_UPSTREAM_NOT_CONFIGURED', '上游数据源尚未接入');
    },
    async fetchPlayerOperators(_query) {
      throw createCoreError('E_UPSTREAM_NOT_CONFIGURED', '上游数据源尚未接入');
    },
    fetchPlayerMatches,
  };
}

module.exports = {
  STATS_CACHE_TTL_MS,
  OPERATORS_CACHE_TTL_MS,
  PLATFORMS,
  DEFAULT_PLATFORM,
  NICKNAME_MAX_LENGTH,
  RP_HISTORY_MAX_POINTS,
  UBI_AUTH_BASE_URL,
  UBI_API_BASE_URL,
  UBI_APP_ID_DEFAULT,
  UBI_SPACE_IDS,
  UBI_SESSION_TTL_MS,
  MATCHES_PAGE_SIZE,
  MATCHES_LIST_TTL_MS,
  MATCH_TTL_MS,
  PLAYER_UID_TTL_MS,
  createCoreError,
  normalizeRatio,
  normalizeRpHistory,
  normalizeUpstreamStats,
  normalizeOperatorStats,
  normalizeUbiMatches,
  validatePlayerStatsQuery,
  validatePlayerMatchesQuery,
  normalizeCacheKey,
  createArenyzeClient,
  createUbiClient,
  createUpstreamClient,
  readUbiCredentials,
};
