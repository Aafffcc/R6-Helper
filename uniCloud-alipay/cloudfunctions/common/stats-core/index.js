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

/**
 * 上游客户端工厂：按 uni-config-center 的 r6-upstream 配置分发。
 * 配置缺失或 provider 未知时维持“上游未接入”降级语义。
 * config.fetchImpl 仅作测试注入点，真实配置来自 JSON，不会带函数。
 */
function createUpstreamClient(config) {
  const source = isPlainObject(config) ? config : {};
  if (source.provider === 'arenyze') {
    return createArenyzeClient(source, source.fetchImpl);
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
  };
}

module.exports = {
  STATS_CACHE_TTL_MS,
  OPERATORS_CACHE_TTL_MS,
  PLATFORMS,
  DEFAULT_PLATFORM,
  NICKNAME_MAX_LENGTH,
  RP_HISTORY_MAX_POINTS,
  createCoreError,
  normalizeRatio,
  normalizeRpHistory,
  normalizeUpstreamStats,
  normalizeOperatorStats,
  validatePlayerStatsQuery,
  normalizeCacheKey,
  createArenyzeClient,
  createUpstreamClient,
};
