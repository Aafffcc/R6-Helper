import { callCloudObject, getCloudClient } from './cloud';
import { AppError, toAppError, unwrapCloudResult } from '@/types/errors';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 流式帧：思维链与最终回答分类型推送，页面据此分别渲染。 */
export interface AgentFrame {
  type: 'think' | 'answer';
  text: string;
}

export interface AgentStreamResult {
  answer: string;
  /** 思维链全文；模型未输出思维链时为空串 */
  reasoning: string;
  transport: 'sse' | 'plain';
}

/** 客户端 SSEChannel 在 SDK 中无类型声明，这里声明用到的最小子集。 */
interface AgentSseChannel {
  on(event: string, listener: (payload?: unknown) => void): void;
  open(): Promise<void>;
  close(): void;
}

/** 预热通道的有效期：超过后可能已被服务端回收，发送时重建，避免静默丢帧。 */
const WARM_CHANNEL_TTL_MS = 2 * 60 * 1000;

interface WarmChannel {
  channel: AgentSseChannel;
  opened: Promise<boolean>;
  createdAt: number;
}

let activeChannel: AgentSseChannel | null = null;
let warmChannel: WarmChannel | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createSseChannel(): AgentSseChannel | null {
  const candidate = getCloudClient() as unknown as { SSEChannel?: new () => AgentSseChannel };
  if (typeof candidate.SSEChannel !== 'function') {
    return null;
  }
  return new candidate.SSEChannel();
}

function closeChannelSafe(channel: AgentSseChannel, scene: string): void {
  try {
    channel.close();
  } catch (closeError) {
    console.error(`[agent] channel.close 异常（${scene}）`, closeError);
  }
}

/**
 * 预建并打开流式通道，把个推 websocket 握手从发送时的首字路径上摘掉。
 * 页面 onShow 与每次请求结束后调用；已有未过期预热通道时幂等。
 */
export function warmAgentChannel(): void {
  if (warmChannel !== null && Date.now() - warmChannel.createdAt < WARM_CHANNEL_TTL_MS) {
    return;
  }
  if (warmChannel !== null) {
    const stale = warmChannel;
    warmChannel = null;
    closeChannelSafe(stale.channel, '预热通道过期');
  }
  const channel = createSseChannel();
  if (channel === null) {
    // SDK 无 SSEChannel（如 H5 端）：不预热，发送时自然降级为非流式
    return;
  }
  const opened = channel
    .open()
    .then(() => true)
    .catch((openError) => {
      console.error('[agent] 预热通道打开失败，发送时降级为非流式', openError);
      return false;
    });
  warmChannel = { channel, opened, createdAt: Date.now() };
}

/** 发送时兜底创建通道：预热缺失（页面未触发 onShow）时保持原有可用性。 */
async function openChannelNow(): Promise<AgentSseChannel | null> {
  const channel = createSseChannel();
  if (channel === null) {
    return null;
  }
  try {
    await channel.open();
    return channel;
  } catch (openError) {
    console.error('[agent] 流式通道不可用，降级为非流式', openError);
    return null;
  }
}

/** 取走预热通道（取走即失效）；过期或预热失败时现场重建 / 降级。 */
async function acquireChannel(): Promise<AgentSseChannel | null> {
  const warm = warmChannel;
  warmChannel = null;
  if (warm === undefined || warm === null) {
    return openChannelNow();
  }
  const opened = await warm.opened;
  if (!opened) {
    return null;
  }
  if (Date.now() - warm.createdAt >= WARM_CHANNEL_TTL_MS) {
    closeChannelSafe(warm.channel, '预热通道过期');
    return openChannelNow();
  }
  return warm.channel;
}

/** 云端 write 的帧是 JSON 文本；兼容载荷结构变化与非 JSON 纯文本（按回答处理）。 */
function parseFrame(payload: unknown): AgentFrame | null {
  let raw: string;
  if (typeof payload === 'string') {
    raw = payload;
  } else if (isRecord(payload)) {
    const candidates = [payload.reply, payload.delta, payload.text, payload.data, payload.content];
    raw = candidates.find((candidate) => typeof candidate === 'string') ?? '';
  } else {
    return null;
  }
  if (raw === '') {
    return null;
  }
  if (raw.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        isRecord(parsed) &&
        (parsed.t === 'think' || parsed.t === 'answer') &&
        typeof parsed.d === 'string'
      ) {
        return { type: parsed.t, text: parsed.d };
      }
    } catch {
      // 非 JSON 文本：按纯文本回答处理
    }
  }
  return { type: 'answer', text: raw };
}

/** 双参数直调（callCloudObject 只支持单参数；通道必须作为第二个参数传给云对象）。 */
async function invokeAgentChat(
  messages: AgentMessage[],
  channel: AgentSseChannel | null,
): Promise<Record<string, unknown>> {
  const target = getCloudClient().importObject('agent', {
    customUI: true,
  }) as unknown as Record<string, unknown>;
  const chat = target.chat;
  if (typeof chat !== 'function') {
    throw new AppError('E_UNKNOWN', '云对象 agent 不存在 chat 方法（请确认已上传最新版）');
  }
  const invoke = chat as (params: unknown, channel?: unknown) => Promise<unknown>;
  try {
    const raw = await invoke({ messages }, channel);
    return unwrapCloudResult(raw);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function askAgent(messages: AgentMessage[]): Promise<string> {
  const result = await callCloudObject<{ answer?: unknown }>('agent', 'chat', { messages });
  if (typeof result?.answer !== 'string' || result.answer.trim() === '') {
    throw new AppError('E_UNKNOWN', 'Agent 返回的回答为空');
  }
  return result.answer.trim();
}

/**
 * 流式问答：优先复用 warmAgentChannel 预热的通道，逐帧回调 onFrame；
 * 通道不可用自动降级为整段返回。返回完整回答、思维链与实际使用的传输方式。
 */
export async function askAgentStream(
  messages: AgentMessage[],
  onFrame: (frame: AgentFrame) => void,
): Promise<AgentStreamResult> {
  const channel = await acquireChannel();
  if (channel !== null) {
    // 服务端仅在 chat 执行期间写帧，请求前完成订阅即可覆盖全部帧
    channel.on('message', (payload) => {
      const frame = parseFrame(payload);
      if (frame !== null) {
        onFrame(frame);
      }
    });
  }
  activeChannel = channel;
  try {
    const result = await invokeAgentChat(messages, channel);
    const answer = typeof result.answer === 'string' ? result.answer.trim() : '';
    if (answer === '') {
      throw new AppError('E_UNKNOWN', 'Agent 返回的回答为空');
    }
    return {
      answer,
      reasoning: typeof result.reasoning === 'string' ? result.reasoning : '',
      transport: channel !== null && result.transport === 'sse' ? 'sse' : 'plain',
    };
  } finally {
    if (activeChannel === channel) {
      activeChannel = null;
      if (channel !== null) {
        closeChannelSafe(channel, '请求收尾');
      }
    } else {
      // stopAgentStream 已关闭通道并置空，不再重复 close
      activeChannel = null;
    }
    // 本轮结束后立即预热下一轮通道：握手耗时落到两轮之间的空闲期，不占下次首字延迟
    warmAgentChannel();
  }
}

/** 用户主动停止：关闭通道中止逐帧渲染；服务端本轮仍会自然结束（额度照常计 1 次）。 */
export function stopAgentStream(): void {
  if (activeChannel !== null) {
    closeChannelSafe(activeChannel, '停止流式');
    activeChannel = null;
  }
  warmAgentChannel();
}
