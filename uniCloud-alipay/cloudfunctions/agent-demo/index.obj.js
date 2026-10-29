'use strict';

/**
 * Phase 0 Spike 云对象（临时）：在支付宝云空间实测 uni-ai 流式 + SSEChannel 链路。
 * 验证数据回写 docs/agent-dev-plan.md 后整个目录删除，不属于正式业务代码。
 * 返回结构刻意携带诊断字段，供 Spike 页面展示原始结果；密钥只从 uni-config-center 读取。
 */

const { DEFAULT_SYSTEM_PROMPT, validateMessages } = require('agent-core');

const SPIKE_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 200;

function error(errCode, errMsg) {
  return { errCode, errMsg };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    console.error('[agent-demo] 配置加载失败', loadError);
    return null;
  }
}

/**
 * uni-ai 载荷结构以实测为准：非流式返回顶层 reply（实测 2026-10-23），
 * 流事件可能是 OpenAI 风格的 choices[].delta.content，这里做防御性提取覆盖所有已知形态。
 */
function extractText(chunk) {
  if (typeof chunk === 'string') {
    return chunk;
  }
  if (isPlainObject(chunk)) {
    const candidates = [chunk.reply, chunk.delta, chunk.text, chunk.data, chunk.content];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        return candidate;
      }
    }
    if (isPlainObject(chunk.message) && typeof chunk.message.content === 'string') {
      return chunk.message.content;
    }
    if (Array.isArray(chunk.choices) && isPlainObject(chunk.choices[0])) {
      const choice = chunk.choices[0];
      if (isPlainObject(choice.delta) && typeof choice.delta.content === 'string') {
        return choice.delta.content;
      }
      if (isPlainObject(choice.message) && typeof choice.message.content === 'string') {
        return choice.message.content;
      }
      if (typeof choice.text === 'string') {
        return choice.text;
      }
    }
  }
  return '';
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

module.exports = {
  /**
   * Spike 入口。sseChannel 由客户端调用时作为第二个参数传入（见 DCloud 问答 #40518）；
   * 不传通道时走非流式对照路径，用于测量完整回答耗时。
   */
  async chat(params, sseChannel) {
    const startedAt = Date.now();
    const config = loadConfig();
    if (config === null) {
      return error('E_UPSTREAM_NOT_CONFIGURED', 'r6-agent 配置未填写（apiKey/baseUrl/model）');
    }
    try {
      const messages = validateMessages(isPlainObject(params) ? params.messages : null);
      const chatMessages = [{ role: 'system', content: config.systemPrompt }, ...messages];

      if (sseChannel !== undefined && sseChannel !== null) {
        return await chatViaChannel(config, chatMessages, sseChannel, startedAt);
      }
      return await chatWithoutChannel(config, chatMessages, startedAt);
    } catch (chatError) {
      if (isPlainObject(chatError) && typeof chatError.errCode === 'string') {
        return chatError;
      }
      console.error('[agent-demo] chat 执行异常', chatError);
      return error('E_UNKNOWN', 'Spike 执行失败');
    }
  },
};

/** 流式路径：还原通道 → uni-ai stream → 逐帧 write → end。 */
async function chatViaChannel(config, chatMessages, sseChannel, startedAt) {
  // Spike 检查点 1：云端运行时是否提供 deserializeSSEChannel
  if (!isPlainObject(uniCloud) || typeof uniCloud.deserializeSSEChannel !== 'function') {
    return error('E_NO_CHANNEL_API', '云端运行时不存在 uniCloud.deserializeSSEChannel');
  }
  let channel;
  try {
    channel = uniCloud.deserializeSSEChannel(sseChannel);
  } catch (channelError) {
    console.error('[agent-demo] 通道还原失败', channelError);
    return error('E_CHANNEL_RECOVER_FAIL', 'deserializeSSEChannel 调用异常');
  }

  const manager = createManager(config);
  if (manager === null) {
    return error('E_NO_UNI_AI', 'uni-cloud-ai 扩展库未生效（getLLMManager 不存在）');
  }

  // Spike 检查点 2：uni-ai 流式调用是否正常建立
  let stream;
  try {
    stream = await manager.chatCompletion({
      model: config.model,
      messages: chatMessages,
      stream: true,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
  } catch (llmError) {
    console.error('[agent-demo] chatCompletion 抛错', llmError);
    return error('E_UPSTREAM_ERROR', `chatCompletion 调用异常: ${llmError && llmError.message}`);
  }

  const timing = () => ({ totalMs: Date.now() - startedAt });
  if (!isPlainObject(stream) || typeof stream.on !== 'function') {
    const answer = extractText(stream);
    channel.write(answer);
    channel.end({ ok: true, answer });
    return { ok: true, transport: 'sse-fallback', answer, timing: timing() };
  }

  return await new Promise((resolve) => {
    let answer = '';
    let firstFrameAt = 0;
    let settled = false;
    const finish = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(guard);
      try {
        channel.end(payload);
      } catch (endError) {
        console.error('[agent-demo] channel.end 异常', endError);
      }
      resolve({
        ok: true,
        transport: 'sse',
        answer,
        timing: {
          totalMs: Date.now() - startedAt,
          firstFrameMs: firstFrameAt === 0 ? null : firstFrameAt - startedAt,
        },
      });
    };
    const guard = setTimeout(
      () => finish(error('E_TIMEOUT', '流式响应超过 30 秒')),
      SPIKE_TIMEOUT_MS,
    );
    stream.on('message', (chunk) => {
      if (firstFrameAt === 0) {
        firstFrameAt = Date.now();
      }
      const text = extractText(chunk);
      answer += text;
      try {
        channel.write(text);
      } catch (writeError) {
        console.error('[agent-demo] channel.write 异常', writeError);
      }
    });
    stream.on('error', (streamError) => {
      console.error('[agent-demo] 流式事件 error', streamError);
      finish(error('E_UPSTREAM_ERROR', '流式事件 error'));
    });
    stream.on('end', () => finish({ ok: true, answer }));
  });
}

/** 非流式对照路径：完整回答一次性返回，测得总耗时与流式对比。 */
async function chatWithoutChannel(config, chatMessages, startedAt) {
  const manager = createManager(config);
  if (manager === null) {
    return error('E_NO_UNI_AI', 'uni-cloud-ai 扩展库未生效（getLLMManager 不存在）');
  }
  let result;
  try {
    result = await manager.chatCompletion({
      model: config.model,
      messages: chatMessages,
      stream: false,
      max_tokens: MAX_OUTPUT_TOKENS,
    });
  } catch (llmError) {
    console.error('[agent-demo] 非流式 chatCompletion 抛错', llmError);
    return error('E_UPSTREAM_ERROR', `chatCompletion 调用异常: ${llmError && llmError.message}`);
  }
  const answer = extractText(result);
  return {
    ok: true,
    transport: 'plain',
    answer,
    timing: { totalMs: Date.now() - startedAt },
    raw: answer === '' ? result : undefined,
  };
}
