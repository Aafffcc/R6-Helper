'use strict';

/**
 * stats 云对象：战绩查询的唯一编排入口。
 * 职责仅限参数校验、缓存读写与调用 stats-core，归一化与上游适配逻辑在公共模块中。
 *
 * 错误约定：抛出携带 errCode 的 Error，客户端按 errCode 映射提示。
 */

const {
  STATS_CACHE_TTL_MS,
  createUpstreamClient,
  normalizeCacheKey,
  normalizeUpstreamStats,
  validatePlayerStatsQuery,
} = require('stats-core');

const cacheCollection = uniCloud.database().collection('stats-cache');

// 上游凭据统一存放在 uni-config-center（r6-upstream 插件）。
// 本地未安装 uni-config-center 时降级为“上游未接入”，不影响云对象加载与缓存查询。
let upstreamConfig = null;
try {
  const uniConfigCenter = require('uni-config-center');
  upstreamConfig = uniConfigCenter({ pluginId: 'r6-upstream' }).config() || null;
} catch {
  console.warn('[stats] uni-config-center 未就绪，上游适配降级为未接入状态');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 命中未过期缓存时返回归一化战绩；缓存异常仅告警降级，不阻断查询主链路。
async function readFreshCache(cacheKey) {
  try {
    const result = await cacheCollection.doc(cacheKey).get();
    const doc = result.data && result.data.length > 0 ? result.data[0] : null;
    if (!doc || typeof doc.expiresAt !== 'number' || doc.expiresAt <= Date.now()) {
      return null;
    }
    return isPlainObject(doc.data) ? doc.data : null;
  } catch (error) {
    console.error('[stats] 缓存读取失败，降级直连上游', error);
    return null;
  }
}

async function writeCache(cacheKey, query, stats) {
  const now = Date.now();
  try {
    await cacheCollection.doc(cacheKey).set({
      cacheKey,
      platform: query.platform,
      nickname: query.nickname,
      data: stats,
      fetchedAt: now,
      expiresAt: now + STATS_CACHE_TTL_MS,
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
 * 响应信封约定：成功返回 { errCode: 'OK', ...data }，
 * 业务错误返回 { errCode, errMsg }（HTTP 200，不 throw）。
 * 支付宝云调用层不会还原 throw 的错误码——无论 Error 还是普通对象
 * 都会变成调用失败（400/500）并丢失 errCode，客户端只能拿到未知错误。
 */
function toErrorResponse(error) {
  if (isPlainObject(error) && typeof error.errCode === 'string') {
    return error;
  }
  if (error instanceof Error) {
    // 未携带 errCode 的 Error 属于非预期异常，统一按未知错误收敛并记日志
    const errCode = typeof error.errCode === 'string' ? error.errCode : 'E_UNKNOWN';
    return { errCode, errMsg: error.message };
  }
  return { errCode: 'E_UNKNOWN', errMsg: '查询失败' };
}

module.exports = {
  async getPlayerStats(params) {
    try {
      const query = validatePlayerStatsQuery(params);
      const cacheKey = normalizeCacheKey(query.platform, query.nickname);

      // 配额纪律：同一查询在缓存有效期内不得重复请求上游
      const cached = await readFreshCache(cacheKey);
      if (cached) {
        return { errCode: 'OK', stats: cached, fromCache: true };
      }

      const raw = await fetchUpstreamStats(query);
      const stats = normalizeUpstreamStats(raw, {
        nickname: query.nickname,
        platform: query.platform,
      });
      await writeCache(cacheKey, query, stats);
      return { errCode: 'OK', stats, fromCache: false };
    } catch (error) {
      const response = toErrorResponse(error);
      if (response.errCode === 'E_UNKNOWN' || response.errCode === 'E_UPSTREAM_ERROR') {
        // 非预期错误保留原始堆栈进云端日志，便于排查
        console.error('[stats] getPlayerStats 执行异常', error);
      }
      return response;
    }
  },
};
