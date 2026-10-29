/**
 * Phase 0 Spike 客户端服务（临时）：验证 CLI 构建下 SSEChannel 客户端链路可用性。
 * 结论回写 docs/agent-dev-plan.md 后，随 agent-demo 云对象一并删除。
 * 结果不经过 unwrapCloudResult / toAppError 收敛：Spike 需要展示原始 errCode 供诊断。
 */
import { getCloudClient } from './cloud';

/** 客户端 SSEChannel 在 SDK 中无类型声明，这里声明 Spike 用到的最小子集。 */
interface SpikeSseChannel {
  on(event: string, listener: (payload?: unknown) => void): void;
  open(): Promise<void>;
  close(): void;
}

export interface SpikeOutcome {
  transport: 'sse' | 'plain' | 'unavailable';
  ok: boolean;
  errCode: string | null;
  errMsg: string | null;
  answer: string;
  firstFrameMs: number | null;
  totalMs: number | null;
  frameCount: number;
  /** 回答提取失败时携带云端原始返回，供 Spike 页面展示定位结构差异 */
  raw: unknown;
}

export interface SpikeRunOptions {
  preferChannel: boolean;
  onFrame(text: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createSseChannel(): SpikeSseChannel | null {
  const candidate = getCloudClient() as unknown as { SSEChannel?: new () => SpikeSseChannel };
  if (typeof candidate.SSEChannel !== 'function') {
    return null;
  }
  return new candidate.SSEChannel();
}

/** 客户端收到的帧即云端 write 的内容，形态理论上为 string，这里仍做防御性提取。 */
function extractText(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  if (isRecord(payload)) {
    const candidates = [payload.delta, payload.text, payload.data, payload.content];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        return candidate;
      }
    }
  }
  return '';
}

async function invokeSpikeChat(
  messages: Array<{ role: 'user'; content: string }>,
  channel: SpikeSseChannel | null,
): Promise<unknown> {
  const target = getCloudClient().importObject('agent-demo', {
    customUI: true,
  }) as unknown as Record<string, unknown>;
  const chat = target.chat;
  if (typeof chat !== 'function') {
    throw new Error('云对象 agent-demo 不存在 chat 方法（请确认已上传）');
  }
  const invoke = chat as (params: unknown, channel?: unknown) => Promise<unknown>;
  return await invoke({ messages }, channel);
}

function summarize(
  raw: unknown,
  transport: SpikeOutcome['transport'],
  frameCount: number,
  firstFrameMs: number | null,
): SpikeOutcome {
  if (!isRecord(raw)) {
    return {
      transport,
      ok: false,
      errCode: 'E_CLIENT',
      errMsg: '云对象响应结构异常',
      answer: '',
      firstFrameMs,
      totalMs: null,
      frameCount,
      raw: null,
    };
  }
  const errCode = typeof raw.errCode === 'string' ? raw.errCode : null;
  const errMsg = typeof raw.errMsg === 'string' ? raw.errMsg : null;
  const answer = typeof raw.answer === 'string' ? raw.answer : '';
  const timing = isRecord(raw.timing) ? raw.timing : {};
  return {
    transport:
      typeof raw.transport === 'string' ? (raw.transport as SpikeOutcome['transport']) : transport,
    ok: raw.ok === true,
    errCode,
    errMsg,
    answer,
    firstFrameMs,
    totalMs: typeof timing.totalMs === 'number' ? timing.totalMs : null,
    frameCount,
    raw: answer === '' ? (raw.raw ?? raw) : null,
  };
}

export async function runSpikeChat(
  prompt: string,
  options: SpikeRunOptions,
): Promise<SpikeOutcome> {
  const startedAt = Date.now();
  const messages = [{ role: 'user' as const, content: prompt }];
  const fail = (errMsg: string, transport: SpikeOutcome['transport']): SpikeOutcome => ({
    transport,
    ok: false,
    errCode: 'E_CLIENT',
    errMsg,
    answer: '',
    firstFrameMs: null,
    totalMs: Date.now() - startedAt,
    frameCount: 0,
    raw: null,
  });

  if (options.preferChannel) {
    const channel = createSseChannel();
    if (channel === null) {
      return fail('客户端 SDK 未暴露 SSEChannel（CLI 构建或 SDK 版本问题）', 'unavailable');
    }
    let frameCount = 0;
    let firstFrameMs: number | null = null;
    channel.on('message', (payload) => {
      if (firstFrameMs === null) {
        firstFrameMs = Date.now() - startedAt;
      }
      frameCount += 1;
      options.onFrame(extractText(payload));
    });
    try {
      await channel.open();
    } catch (openError) {
      console.error('[agent-demo] 通道 open 失败', openError);
      return fail(
        `SSEChannel open 失败: ${openError instanceof Error ? openError.message : String(openError)}`,
        'sse',
      );
    }
    try {
      const raw = await invokeSpikeChat(messages, channel);
      return summarize(raw, 'sse', frameCount, firstFrameMs);
    } catch (invokeError) {
      return fail(invokeError instanceof Error ? invokeError.message : String(invokeError), 'sse');
    } finally {
      channel.close();
    }
  }

  try {
    const raw = await invokeSpikeChat(messages, null);
    return summarize(raw, 'plain', 0, null);
  } catch (invokeError) {
    return fail(invokeError instanceof Error ? invokeError.message : String(invokeError), 'plain');
  }
}
