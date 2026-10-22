'use strict';

/**
 * stats 云对象：战绩查询的唯一编排入口。
 * 职责仅限参数校验、缓存读写与调用 stats-core，归一化与上游适配逻辑在公共模块中。
 *
 * 错误约定：抛出携带 errCode 的 Error，客户端按 errCode 映射提示。
 */

const {
  OPERATORS_CACHE_TTL_MS,
  STATS_CACHE_TTL_MS,
  createUpstreamClient,
  normalizeCacheKey,
  normalizeOperatorStats,
  normalizeUpstreamStats,
  validatePlayerStatsQuery,
} = require('stats-core');

const cacheCollection = uniCloud.database().collection('stats-cache');

// 归一化响应增加字段时递增，避免仍在 TTL 内的旧载荷缺少新字段。
const CACHE_SCHEMA_VERSION = 2;

// 上游凭据统一存放在 uni-config-center（r6-upstream 插件）。
// 配置加载状态必须留痕到云端日志：模块缺失、配置缺失、key 为空三种情况
// 在客户端都表现为 E_UPSTREAM_NOT_CONFIGURED，只有这里能分辨真实原因。
let upstreamConfig = null;
try {
  const uniConfigCenter = require('uni-config-center');
  const loaded = uniConfigCenter({ pluginId: 'r6-upstream' }).config();
  if (isPlainObject(loaded) && typeof loaded.apiKey === 'string' && loaded.apiKey.trim() !== '') {
    upstreamConfig = loaded;
    // 只记录 provider 与 key 长度，禁止输出 key 本体
    console.log(
      `[stats] r6-upstream 配置已加载：provider=${String(loaded.provider ?? '未知')}，apiKey 长度=${loaded.apiKey.trim().length}`,
    );
  } else if (isPlainObject(loaded)) {
    console.error('[stats] r6-upstream/config.json 存在但 apiKey 为空，上游保持未接入');
  } else {
    console.error(
      '[stats] 未找到 r6-upstream/config.json：请上传公共模块 common/uni-config-center 并重传 stats',
    );
  }
} catch (error) {
  console.error(
    '[stats] uni-config-center 模块加载失败：请上传公共模块 common/uni-config-center 并重传 stats',
    error,
  );
}

console.log(
  `[stats] 运行时探针：Node ${process.version}，fetch 可用=${typeof globalThis.fetch === 'function'}`,
);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 命中未过期缓存时返回归一化战绩；缓存异常仅告警降级，不阻断查询主链路。
async function readFreshCache(cacheKey) {
  try {
    const result = await cacheCollection.doc(cacheKey).get();
    const doc = result.data && result.data.length > 0 ? result.data[0] : null;
    if (
      !doc ||
      doc.cacheVersion !== CACHE_SCHEMA_VERSION ||
      typeof doc.expiresAt !== 'number' ||
      doc.expiresAt <= Date.now()
    ) {
      return null;
    }
    return isPlainObject(doc.data) ? doc.data : null;
  } catch (error) {
    console.error('[stats] 缓存读取失败，降级直连上游', error);
    return null;
  }
}

async function writeCache(cacheKey, query, data, ttlMs = STATS_CACHE_TTL_MS) {
  const now = Date.now();
  try {
    await cacheCollection.doc(cacheKey).set({
      cacheKey,
      platform: query.platform,
      nickname: query.nickname,
      cacheVersion: CACHE_SCHEMA_VERSION,
      data,
      fetchedAt: now,
      expiresAt: now + ttlMs,
    });
  } catch (error) {
    // 写缓存失败不影响本次返回，仅影响下一次命中率
    console.error('[stats] 缓存写入失败', error);
  }
}

async function fetchUpstreamStats(query) {
  const client = createUpstreamClient(upstreamConfig);
  return client.fetchPlayerStats(query);
}

/**
 * 响应约定（实测 2026-10，依据客户端 SDK 传输层源码）：
 *
 * 支付宝云 transport 把函数返回值原样作为 result 交给 importObject；
 * importObject 约定：result.errCode 为真值即视为业务错误——SDK 自行抛出
 * `{ code: errCode, message: errMsg }`（错误码与消息都完整保留），
 * 否则把 result 原样交给调用方。因此：
 * - 成功载荷不带 errCode：`{ ok: true, ... }`；
 * - 业务错误返回 `{ errCode, errMsg }`，由客户端 toAppError 收敛；
 * - 顶层占用 errCode:'OK' 会被误判为错误（空消息 + 空弹窗），禁止。
 */
function toErrorData(error) {
  if (isPlainObject(error) && typeof error.errCode === 'string') {
    return {
      errCode: error.errCode,
      errMsg:
        typeof error.errMsg === 'string' && error.errMsg !== '' ? error.errMsg : error.errCode,
    };
  }
  if (error instanceof Error) {
    const errCode = typeof error.errCode === 'string' ? error.errCode : 'E_UNKNOWN';
    return { errCode, errMsg: error.message };
  }
  return { errCode: 'E_UNKNOWN', errMsg: '查询失败' };
}

function handleObjectError(method, error) {
  const data = toErrorData(error);
  if (data.errCode === 'E_UNKNOWN' || data.errCode === 'E_UPSTREAM_ERROR') {
    // 非预期错误保留原始堆栈进云端日志，便于排查
    console.error(`[stats] ${method} 执行异常`, error);
  }
  console.log(`[stats] ${method} 响应业务错误：${data.errCode}`);
  return data;
}

module.exports = {
  async getPlayerStats(params) {
    try {
      const query = validatePlayerStatsQuery(params);
      const cacheKey = normalizeCacheKey(query.platform, query.nickname);

      // 配额纪律：同一查询在缓存有效期内不得重复请求上游
      const cached = await readFreshCache(cacheKey);
      if (cached) {
        console.log('[stats] 缓存命中，直接返回');
        return { ok: true, stats: cached, fromCache: true };
      }
      console.log('[stats] 缓存未命中，请求上游 arenyze');
      const raw = await fetchUpstreamStats(query);
      const stats = normalizeUpstreamStats(raw, {
        nickname: query.nickname,
        platform: query.platform,
      });
      await writeCache(cacheKey, query, stats);
      console.log('[stats] 上游请求成功，已写缓存');
      return { ok: true, stats, fromCache: false };
    } catch (error) {
      return handleObjectError('getPlayerStats', error);
    }
  },

  /**
   * 干员聚合统计：独立缓存键（基础键 + _ops 后缀）与更长有效期，
   * 与主查询分开请求上游，主战绩查询不因此多花上游配额。
   */
  async getPlayerOperators(params) {
    try {
      const query = validatePlayerStatsQuery(params);
      const cacheKey = `${normalizeCacheKey(query.platform, query.nickname)}_ops`;

      const cached = await readFreshCache(cacheKey);
      if (Array.isArray(cached?.operators)) {
        console.log('[stats] 干员缓存命中，直接返回');
        return { ok: true, operators: cached.operators, fromCache: true };
      }
      console.log('[stats] 干员缓存未命中，请求上游 arenyze');
      const client = createUpstreamClient(upstreamConfig);
      const raw = await client.fetchPlayerOperators(query);
      const operators = normalizeOperatorStats(raw);
      await writeCache(cacheKey, query, { operators }, OPERATORS_CACHE_TTL_MS);
      console.log('[stats] 干员上游请求成功，已写缓存');
      return { ok: true, operators, fromCache: false };
    } catch (error) {
      return handleObjectError('getPlayerOperators', error);
    }
  },
};
