'use strict';

/**
 * Agent 云对象：接收短会话消息，调用 OpenAI Chat Completions 兼容接口。
 * API key、base URL 和模型名只从 uni-config-center 读取，绝不返回客户端。
 */

const DAILY_REQUEST_LIMIT = 20;
const { DEFAULT_SYSTEM_PROMPT, requestModel, validateMessages } = require('agent-core');

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

async function consumeDailyQuota(clientInfo, config) {
  const clientIp =
    isPlainObject(clientInfo) && typeof clientInfo.clientIP === 'string'
      ? clientInfo.clientIP
      : 'unknown';
  const crypto = require('crypto');
  const clientKey = crypto.createHmac('sha256', config.apiKey).update(clientIp).digest('hex');
  const bucket = new Date().toISOString().slice(0, 10);
  const collection = uniCloud.database().collection('agent-usage');
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
    updatedAt: Date.now(),
  });
}

module.exports = {
  async chat(params) {
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
      const answer = await requestModel(config, messages);
      return { ok: true, answer };
    } catch (chatError) {
      if (isPlainObject(chatError) && typeof chatError.errCode === 'string') {
        return chatError;
      }
      console.error('[agent] chat 执行异常', chatError);
      return error('E_UNKNOWN', 'Agent 请求失败');
    }
  },
};
