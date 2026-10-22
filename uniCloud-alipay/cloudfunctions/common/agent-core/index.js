'use strict';

const MAX_MESSAGES = 16;
const MAX_MESSAGE_LENGTH = 1200;
const MAX_OUTPUT_TOKENS = 900;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SYSTEM_PROMPT =
  '你是彩虹六号 Siege 垂直领域助手。用简洁、可执行的中文回答，优先说明前提、站位、干员职责和风险；不确定的版本数据要明确说不确定，不要编造实时数值。';

function error(errCode, errMsg) {
  return { errCode, errMsg };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    throw error('E_INVALID_PARAM', `消息数量须为 1-${MAX_MESSAGES} 条`);
  }
  const messages = value.map((item) => {
    if (
      !isPlainObject(item) ||
      (item.role !== 'user' && item.role !== 'assistant') ||
      typeof item.content !== 'string'
    ) {
      throw error('E_INVALID_PARAM', '消息格式不正确');
    }
    const content = item.content.trim();
    if (content === '' || content.length > MAX_MESSAGE_LENGTH) {
      throw error('E_INVALID_PARAM', `每条消息最多 ${MAX_MESSAGE_LENGTH} 字`);
    }
    return { role: item.role, content };
  });
  if (messages[messages.length - 1].role !== 'user') {
    throw error('E_INVALID_PARAM', '最后一条消息必须来自用户');
  }
  return messages;
}

function getEndpoint(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function extractAnswer(payload) {
  const choice =
    isPlainObject(payload) && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = isPlainObject(choice) ? choice.message : null;
  return isPlainObject(message) && typeof message.content === 'string'
    ? message.content.trim()
    : '';
}

async function requestModel(config, messages) {
  if (typeof fetch !== 'function') {
    throw error('E_UPSTREAM_ERROR', '云端运行时不支持模型请求');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(getEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: config.systemPrompt }, ...messages],
        temperature: 0.4,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[agent] 模型响应 HTTP ${response.status}`);
      throw error('E_UPSTREAM_ERROR', '模型服务暂时不可用');
    }
    const payload = await response.json();
    const answer = extractAnswer(payload);
    if (answer === '') {
      throw error('E_UPSTREAM_ERROR', '模型未返回有效回答');
    }
    return answer;
  } catch (requestError) {
    if (requestError && requestError.errCode) {
      throw requestError;
    }
    console.error('[agent] 模型请求失败', requestError);
    throw error('E_UPSTREAM_ERROR', '模型服务暂时不可用');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  requestModel,
  validateMessages,
};
