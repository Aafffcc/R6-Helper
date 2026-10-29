'use strict';

/**
 * Agent 云对象：接收多轮消息，经 uni-ai 调用 OpenAI 兼容模型（provider: openai + proxy）。
 * sseChannel 存在时走 SSEChannel 流式逐帧推送（JSON 帧，见 agent-core encodeFrame）；
 * 通道缺失或还原失败自动降级为整段返回（留日志说明）。
 * 思维链（reasoning_content）随帧与最终响应单独返回，历史思维链不回传上下文。
 * API key、base URL 和模型名只从 uni-config-center 读取，绝不返回客户端。
 * 额度按用户消息计：一次 chat 调用 = 1 次，含未来工具循环的全部上游轮次（见 agent-usage schema）。
 */

const DAILY_REQUEST_LIMIT = 20;
const { DEFAULT_SYSTEM_PROMPT, runModelCall, validateMessages } = require('agent-core');

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function error(errCode, errMsg) {
  return { errCode, errMsg };
}

function loadConfig() {
  try {
    const center = require('uni-config-center');
    const config = center({ pluginId: 'r6-agent' }).config();
    if (
      !isPlainObject(config) ||
      typeof config.apiKey !== 'string' ||
      config.apiKey.trim() === '' ||
      typeof config.baseUrl !== 'string' ||
      config.baseUrl.trim() === '' ||
      typeof config.model !== 'string' ||
      config.model.trim() === ''
    ) {
      return null;
    }
    return {
      apiKey: config.apiKey.trim(),
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      systemPrompt:
        typeof config.systemPrompt === 'string' && config.systemPrompt.trim() !== ''
          ? config.systemPrompt.trim()
          : DEFAULT_SYSTEM_PROMPT,
    };
  } catch (loadError) {
    console.error('[agent] 配置加载失败', loadError);
    return null;
  }
}

function createManager(config) {
  if (!isPlainObject(uniCloud.ai) || typeof uniCloud.ai.getLLMManager !== 'function') {
    return null;
  }
  // provider: 'openai' + proxy 即 OpenAI 兼容端点接法（proxy 视为 baseUrl），凭据不落日志。
  return uniCloud.ai.getLLMManager({
    provider: 'openai',
    proxy: config.baseUrl,
    apiKey: config.apiKey,
  });
}

/** 还原客户端通道；任何失败都降级为 null（整段返回），不阻断问答。 */
function recoverChannelSafe(sseChannel) {
  if (sseChannel === undefined || sseChannel === null) {
    return null;
  }
  if (!isPlainObject(uniCloud) || typeof uniCloud.deserializeSSEChannel !== 'function') {
    console.error('[agent] 云端运行时不存在 uniCloud.deserializeSSEChannel，降级为非流式');
    return null;
  }
  try {
    return uniCloud.deserializeSSEChannel(sseChannel);
  } catch (channelError) {
    console.error('[agent] 通道还原失败，降级为非流式', channelError);
    return null;
  }
}

function endChannelSafe(channel, payload) {
  if (channel === null) {
    return;
  }
  try {
    channel.end(payload);
  } catch (endError) {
    console.error('[agent] channel.end 异常', endError);
  }
}

async function consumeDailyQuota(clientInfo, config) {
  const clientIp =
    isPlainObject(clientInfo) && typeof clientInfo.clientIP === 'string'
      ? clientInfo.clientIP
      : 'unknown';
  const crypto = require('crypto');
  const clientKey = crypto.createHmac('sha256', config.apiKey).update(clientIp).digest('hex');
  const bucket = new Date().toISOString().slice(0, 10);
  const db = uniCloud.database();
  const collection = db.collection('agent-usage');

  // 快速路径：单次条件更新完成「校验 + 计数」，命中即返回，省掉一次读往返（首字延迟敏感路径）。
  // 条件锁定当前日期桶且 count 未达上限，并发下超限请求不会命中（updated=0 走慢路径判定）。
  const bumped = await collection
    .where({ _id: clientKey, bucket, count: db.command.lt(DAILY_REQUEST_LIMIT) })
    .update({
      count: db.command.inc(1),
      totalCalls: db.command.inc(1),
      updatedAt: Date.now(),
    });
  if (isPlainObject(bumped) && typeof bumped.updated === 'number' && bumped.updated > 0) {
    return;
  }

  // 未命中快速路径：新来源 / 跨天 / 已达上限——读旧档区分后收敛。
  const record = await collection.doc(clientKey).get();
  const previous = record.data && record.data.length > 0 ? record.data[0] : null;
  const count = previous && previous.bucket === bucket ? previous.count : 0;
  if (count >= DAILY_REQUEST_LIMIT) {
    throw error('E_RATE_LIMITED', '今日的助手调用次数已达上限，请明天再试');
  }
  await collection.doc(clientKey).set({
    clientKey,
    bucket,
    count: count + 1,
    totalCalls: ((previous && previous.totalCalls) || count) + 1,
    updatedAt: Date.now(),
  });
}

module.exports = {
  async chat(params, sseChannel) {
    let channel = null;
    try {
      const config = loadConfig();
      if (!config) {
        return error('E_UPSTREAM_NOT_CONFIGURED', 'Agent 模型配置尚未填写');
      }
      const messages = validateMessages(isPlainObject(params) ? params.messages : null);
      try {
        await consumeDailyQuota(this.getClientInfo(), config);
      } catch (quotaError) {
        if (isPlainObject(quotaError) && quotaError.errCode === 'E_RATE_LIMITED') {
          throw quotaError;
        }
        console.error('[agent] 调用额度检查失败', quotaError);
        throw error('E_UPSTREAM_ERROR', '请求暂时不可用，请稍后重试');
      }
      const manager = createManager(config);
      if (!manager) {
        return error('E_NO_UNI_AI', 'uni-cloud-ai 扩展库未生效（getLLMManager 不存在）');
      }

      channel = recoverChannelSafe(sseChannel);
      const { answer, reasoning } = await runModelCall({ manager, config, messages, channel });
      endChannelSafe(channel, { ok: true, answer });
      const payload = { ok: true, answer, transport: channel ? 'sse' : 'plain' };
      if (reasoning !== '') {
        payload.reasoning = reasoning;
      }
      return payload;
    } catch (chatError) {
      const payload =
        isPlainObject(chatError) &&
        typeof chatError.errCode === 'string' &&
        typeof chatError.errMsg === 'string'
          ? chatError
          : error('E_UNKNOWN', 'Agent 请求失败');
      if (payload === chatError) {
        endChannelSafe(channel, payload);
        return payload;
      }
      console.error('[agent] chat 执行异常', chatError);
      endChannelSafe(channel, payload);
      return payload;
    }
  },
};
