'use strict';

/**
 * Agent 模型调用纯逻辑（口径唯一来源，含回归测试）：
 * - validateMessages：入参收敛（角色白名单、长度、末条必须 user）；
 * - runModelCall：经注入的 LLMManager 调用模型（uni-ai，OpenAI 兼容协议），
 *   channel 存在时走流式逐帧推送，缺失时整段返回；
 * - 思维链与最终回答分开提取：uni-ai 流式以独立事件 reasoningMessage 下发思维链增量，
 *   非流式在顶层 reasoningReply；推送帧带类型标记（encodeFrame 产出
 *   {"t":"think"|"answer","d":"..."} JSON 帧），客户端按类型渲染。
 * manager / channel 均由调用方注入，本模块不接触 uniCloud 运行时，可独立单测。
 */

const MAX_MESSAGES = 16;
const MAX_MESSAGE_LENGTH = 1200;
const MAX_OUTPUT_TOKENS = 2000;
/**
 * 流式帧间空闲守卫：每收到一帧即重置，连续 15 秒无新帧才判定为上游中断。
 * 不能用总时长口径——长回答（max_tokens 2000）总流式时长可超过 25 秒，会被误杀。
 * 首帧前的等待同样受此守卫约束（思考模型会先流思维链帧，不会触发误判）。
 */
const STREAM_IDLE_GUARD_MS = 15_000;
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

/**
 * 组装模型请求参数：system 提示词置顶，采样与输出上限集中在此口径。
 * 注意：DeepSeek 思考模式（deepseek-flash 默认开启）会忽略 temperature 等采样参数，
 * 该值仅对非思考模型生效，保留作回退口径。
 */
function createChatOptions(config, messages) {
  return {
    model: config.model,
    messages: [{ role: 'system', content: config.systemPrompt }, ...messages],
    temperature: 0.4,
    max_tokens: MAX_OUTPUT_TOKENS,
  };
}

/** 流式帧类型标记：思维链与最终回答分开渲染，客户端按 t 字段路由。 */
const FRAME_TYPES = { THINK: 'think', ANSWER: 'answer' };

function encodeFrame(type, text) {
  return JSON.stringify({ t: type, d: text });
}

/**
 * 提取思维链。DeepSeek 思考模式（deepseek-flash 默认开启）的原始载荷把 CoT 放在
 * choices[].delta.reasoning_content；uni-ai 归一化后流式走独立事件 reasoningMessage
 * （见 runModelCall），非流式放顶层 reasoningReply / choices[].message.reasoningContent。
 * 这里对已知形态做防御性提取，模型不带思维链时恒为空串。
 */
const REASONING_KEYS = ['reasoning_content', 'reasoning', 'reasoningContent'];

function extractReasoning(chunk) {
  if (!isPlainObject(chunk)) {
    return '';
  }
  for (const key of [...REASONING_KEYS, 'reasoningReply']) {
    if (typeof chunk[key] === 'string' && chunk[key] !== '') {
      return chunk[key];
    }
  }
  for (const container of [chunk.delta, chunk.message]) {
    if (isPlainObject(container)) {
      for (const key of REASONING_KEYS) {
        if (typeof container[key] === 'string' && container[key] !== '') {
          return container[key];
        }
      }
    }
  }
  if (Array.isArray(chunk.choices) && isPlainObject(chunk.choices[0])) {
    const choice = chunk.choices[0];
    for (const container of [choice.delta, choice.message]) {
      if (!isPlainObject(container)) {
        continue;
      }
      for (const key of REASONING_KEYS) {
        if (typeof container[key] === 'string' && container[key] !== '') {
          return container[key];
        }
      }
    }
  }
  return '';
}

/**
 * uni-ai 载荷结构以实测为准（2026-10-23：非流式顶层 reply；流事件可能是
 * OpenAI 风格的 choices[].delta.content），这里做防御性提取覆盖所有已知形态。
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

/** 帧推送失败不中断生成（降级须留日志说明），最终结果仍可整段返回。 */
function writeFrameSafe(channel, text) {
  if (text === '') {
    return;
  }
  try {
    channel.write(text);
  } catch (writeError) {
    console.error('[agent-core] 帧推送失败（不中断生成）', writeError);
  }
}

/**
 * 统一模型调用入口。
 * @param {object} input
 * @param {object} input.manager 注入的 LLMManager（uniCloud.ai.getLLMManager 的返回）
 * @param {object} input.config  { apiKey, baseUrl, model, systemPrompt }（apiKey 仅随 manager 使用）
 * @param {Array}  input.messages 已通过 validateMessages 的消息
 * @param {object} [input.channel] 已 deserialize 的 SSEChannel；缺省走非流式
 * @returns {Promise<{answer: string, reasoning: string}>} 业务错误以 { errCode, errMsg } 抛出
 */
async function runModelCall({ manager, config, messages, channel }) {
  const options = createChatOptions(config, messages);
  if (!channel) {
    let result;
    try {
      result = await manager.chatCompletion({ ...options, stream: false });
    } catch (callError) {
      console.error('[agent-core] 非流式调用失败', callError);
      throw error('E_UPSTREAM_ERROR', '模型服务暂时不可用');
    }
    const answer = extractText(result);
    if (answer === '') {
      throw error('E_UPSTREAM_ERROR', '模型未返回有效回答');
    }
    return { answer, reasoning: extractReasoning(result) };
  }

  let stream;
  try {
    stream = await manager.chatCompletion({ ...options, stream: true });
  } catch (callError) {
    console.error('[agent-core] 流式调用建立失败', callError);
    throw error('E_UPSTREAM_ERROR', '模型服务暂时不可用');
  }
  if (!isPlainObject(stream) || typeof stream.on !== 'function') {
    // stream:true 未返回事件流对象时按完整结果处理，一次性补发
    const answer = extractText(stream);
    if (answer === '') {
      throw error('E_UPSTREAM_ERROR', '模型未返回有效回答');
    }
    writeFrameSafe(channel, encodeFrame(FRAME_TYPES.ANSWER, answer));
    return { answer, reasoning: extractReasoning(stream) };
  }

  return await new Promise((resolve, reject) => {
    let answer = '';
    let reasoning = '';
    let settled = false;
    let guard = null;
    let firstChunkLogged = false;
    const settle = (settleError, payload) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(guard);
      if (settleError) {
        reject(settleError);
      } else {
        resolve(payload);
      }
    };
    const armGuard = () => {
      if (settled) {
        return;
      }
      clearTimeout(guard);
      guard = setTimeout(
        () => settle(error('E_UPSTREAM_ERROR', '模型响应中断，请稍后重试')),
        STREAM_IDLE_GUARD_MS,
      );
    };
    armGuard();
    stream.on('message', (chunk) => {
      armGuard();
      if (!firstChunkLogged) {
        firstChunkLogged = true;
        // 一次性诊断日志：确认 uni-ai 实际下发的流式载荷形态，排查后可移除。
        try {
          console.log('[agent-core] 首个流式载荷', JSON.stringify(chunk).slice(0, 400));
        } catch (logError) {
          console.error('[agent-core] 首个流式载荷序列化失败', logError);
        }
      }
      const think = extractReasoning(chunk);
      if (think !== '') {
        reasoning += think;
        writeFrameSafe(channel, encodeFrame(FRAME_TYPES.THINK, think));
      }
      const text = extractText(chunk);
      if (text !== '') {
        answer += text;
        writeFrameSafe(channel, encodeFrame(FRAME_TYPES.ANSWER, text));
      }
    });
    // uni-ai（uni-cloud-ai 1.1.23 源码级确认）把思维链增量以独立事件 reasoningMessage
    // 实时下发（payload 为字符串增量），不经过 message 事件；漏订阅该事件即表现为「无思考内容」。
    let firstReasoningLogged = false;
    stream.on('reasoningMessage', (chunk) => {
      armGuard();
      const think = typeof chunk === 'string' ? chunk : extractReasoning(chunk);
      if (think === '') {
        return;
      }
      if (!firstReasoningLogged) {
        firstReasoningLogged = true;
        // 一次性诊断日志：确认思维链事件链路已通，排查后可移除。
        console.log('[agent-core] reasoningMessage 事件已收到增量');
      }
      reasoning += think;
      writeFrameSafe(channel, encodeFrame(FRAME_TYPES.THINK, think));
    });
    stream.on('error', (streamError) => {
      console.error('[agent-core] 流式事件 error', streamError);
      settle(error('E_UPSTREAM_ERROR', '模型服务暂时不可用'));
    });
    stream.on('end', () => {
      if (answer === '') {
        settle(error('E_UPSTREAM_ERROR', '模型未返回有效回答'));
        return;
      }
      settle(null, { answer, reasoning });
    });
  });
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  STREAM_IDLE_GUARD_MS,
  MAX_OUTPUT_TOKENS,
  FRAME_TYPES,
  createChatOptions,
  encodeFrame,
  error,
  extractReasoning,
  extractText,
  runModelCall,
  validateMessages,
};
