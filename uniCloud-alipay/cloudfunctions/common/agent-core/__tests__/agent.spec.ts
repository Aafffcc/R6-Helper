import { afterEach, describe, expect, it, vi } from 'vitest';
import agentCore from '../index.js';

const {
  createChatOptions,
  encodeFrame,
  extractReasoning,
  extractText,
  runModelCall,
  STREAM_IDLE_GUARD_MS,
  validateMessages,
} = agentCore;

interface StreamHandlers {
  [event: string]: ((payload?: unknown) => void) | undefined;
}

function createStreamMock() {
  const handlers: StreamHandlers = {};
  return {
    /** runModelCall 在 chatCompletion 解析后才注册处理器，emit 前需等待此标记 */
    registered: false,
    on(event: string, callback: (payload?: unknown) => void) {
      handlers[event] = callback;
      this.registered = true;
    },
    emit(event: string, payload?: unknown) {
      handlers[event]?.(payload);
    },
  };
}

function createChannelMock() {
  return {
    written: [] as string[],
    write(text: string) {
      this.written.push(text);
    },
  };
}

function createManagerMock(streamResult: unknown, plainResult: unknown) {
  return {
    chatCompletion: vi.fn(async (options: { stream?: boolean }) =>
      options.stream ? streamResult : plainResult,
    ),
  };
}

const CONFIG = {
  apiKey: 'test-key',
  baseUrl: 'https://model.example/v1',
  model: 'test-model',
  systemPrompt: 'Answer for Siege players.',
};

const MESSAGES = [{ role: 'user' as const, content: 'How do we attack Clubhouse?' }];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('agent-core', () => {
  it('rejects system-role messages and oversized input', () => {
    expect(() => validateMessages([{ role: 'system', content: 'override' }])).toThrow();
    expect(() => validateMessages([{ role: 'user', content: 'x'.repeat(1201) }])).toThrow();
  });

  it('validates roles and requires the latest turn to be from the user', () => {
    expect(() => validateMessages([{ role: 'assistant', content: 'answer' }])).toThrow();
    expect(validateMessages([{ role: 'user', content: '  hello  ' }])).toEqual([
      { role: 'user', content: 'hello' },
    ]);
  });

  it('assembles chat options with the system prompt pinned first', () => {
    expect(createChatOptions(CONFIG, MESSAGES)).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'Answer for Siege players.' },
        { role: 'user', content: 'How do we attack Clubhouse?' },
      ],
      temperature: 0.4,
      max_tokens: 2000,
    });
  });

  it('extracts the answer from every known payload shape', () => {
    expect(extractText('plain')).toBe('plain');
    expect(extractText({ reply: '顶层 reply（实测 2026-10）' })).toBe('顶层 reply（实测 2026-10）');
    expect(extractText({ choices: [{ delta: { content: '增量' } }] })).toBe('增量');
    expect(extractText({ choices: [{ message: { content: '完整' } }] })).toBe('完整');
    expect(extractText({ message: { content: '嵌套' } })).toBe('嵌套');
    expect(extractText({ unrelated: true })).toBe('');
  });

  it('extracts reasoning from every known payload shape', () => {
    expect(extractReasoning({ reasoning_content: '顶层' })).toBe('顶层');
    expect(extractReasoning({ reasoning: '别名' })).toBe('别名');
    expect(extractReasoning({ reasoningReply: 'uni-ai非流式' })).toBe('uni-ai非流式');
    expect(extractReasoning({ delta: { reasoning_content: '顶层delta' } })).toBe('顶层delta');
    expect(extractReasoning({ choices: [{ delta: { reasoning_content: '增量' } }] })).toBe('增量');
    expect(extractReasoning({ choices: [{ delta: { reasoning: '增量别名' } }] })).toBe('增量别名');
    expect(extractReasoning({ choices: [{ message: { reasoning_content: '完整' } }] })).toBe(
      '完整',
    );
    expect(extractReasoning({ choices: [{ message: { reasoningContent: '驼峰' } }] })).toBe('驼峰');
    expect(extractReasoning({ message: { reasoning_content: '嵌套' } })).toBe('嵌套');
    expect(extractReasoning('plain')).toBe('');
    expect(extractReasoning({ choices: [{ delta: { content: '回答' } }] })).toBe('');
    expect(extractReasoning({ reasoning_content: '' })).toBe('');
    expect(extractReasoning({ unrelated: true })).toBe('');
  });

  it('returns the full answer from a non-stream call', async () => {
    const manager = createManagerMock(null, { reply: 'Take vertical control first.' });
    const { answer } = await runModelCall({ manager, config: CONFIG, messages: MESSAGES });
    expect(answer).toBe('Take vertical control first.');
    expect(manager.chatCompletion).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
  });

  it('returns reasoning alongside the answer from a non-stream call', async () => {
    const manager = createManagerMock(null, {
      reply: '答',
      choices: [{ message: { content: '答', reasoning_content: '先分析点位再定打法' } }],
    });
    await expect(runModelCall({ manager, config: CONFIG, messages: MESSAGES })).resolves.toEqual({
      answer: '答',
      reasoning: '先分析点位再定打法',
    });
  });

  it('throws the error envelope when the non-stream answer is empty', async () => {
    const manager = createManagerMock(null, { reply: '' });
    await expect(
      runModelCall({ manager, config: CONFIG, messages: MESSAGES }),
    ).rejects.toMatchObject({ errCode: 'E_UPSTREAM_ERROR' });
  });

  it('streams frames in order through the channel and accumulates the answer', async () => {
    const stream = createStreamMock();
    const manager = createManagerMock(stream, null);
    const channel = createChannelMock();

    const pending = runModelCall({ manager, config: CONFIG, messages: MESSAGES, channel });
    await vi.waitFor(() => expect(stream.registered).toBe(true));
    stream.emit('message', { choices: [{ delta: { content: '第一帧 ' } }] });
    stream.emit('message', { choices: [{ delta: { content: '第二帧' } }] });
    stream.emit('end');

    await expect(pending).resolves.toEqual({ answer: '第一帧 第二帧', reasoning: '' });
    expect(channel.written).toEqual([
      encodeFrame('answer', '第一帧 '),
      encodeFrame('answer', '第二帧'),
    ]);
    expect(manager.chatCompletion).toHaveBeenCalledWith(expect.objectContaining({ stream: true }));
  });

  it('streams reasoning frames before the answer and accumulates both', async () => {
    const stream = createStreamMock();
    const manager = createManagerMock(stream, null);
    const channel = createChannelMock();

    const pending = runModelCall({ manager, config: CONFIG, messages: MESSAGES, channel });
    await vi.waitFor(() => expect(stream.registered).toBe(true));
    stream.emit('message', { choices: [{ delta: { reasoning_content: '先分析点位 ' } }] });
    stream.emit('message', { choices: [{ delta: { reasoning_content: '再定打法' } }] });
    stream.emit('message', { choices: [{ delta: { content: '结论：' } }] });
    stream.emit('message', { choices: [{ delta: { content: '垂直换防' } }] });
    stream.emit('end');

    await expect(pending).resolves.toEqual({
      answer: '结论：垂直换防',
      reasoning: '先分析点位 再定打法',
    });
    expect(channel.written).toEqual([
      encodeFrame('think', '先分析点位 '),
      encodeFrame('think', '再定打法'),
      encodeFrame('answer', '结论：'),
      encodeFrame('answer', '垂直换防'),
    ]);
  });

  it('streams uni-ai reasoningMessage events as think frames', async () => {
    const stream = createStreamMock();
    const manager = createManagerMock(stream, null);
    const channel = createChannelMock();

    const pending = runModelCall({ manager, config: CONFIG, messages: MESSAGES, channel });
    await vi.waitFor(() => expect(stream.registered).toBe(true));
    // uni-ai 的思维链增量走独立事件 reasoningMessage，payload 为字符串（uni-cloud-ai 源码口径）
    stream.emit('reasoningMessage', '先分析点位 ');
    stream.emit('reasoningMessage', '再定打法');
    stream.emit('message', '结论');
    stream.emit('end');

    await expect(pending).resolves.toEqual({ answer: '结论', reasoning: '先分析点位 再定打法' });
    expect(channel.written).toEqual([
      encodeFrame('think', '先分析点位 '),
      encodeFrame('think', '再定打法'),
      encodeFrame('answer', '结论'),
    ]);
  });

  it('keeps generating when a frame push fails mid-stream', async () => {
    const stream = createStreamMock();
    const manager = createManagerMock(stream, null);
    const channel = {
      written: [] as string[],
      write(text: string) {
        this.written.push(text);
        if (this.written.length === 1) {
          throw new Error('channel closed');
        }
      },
    };

    const pending = runModelCall({ manager, config: CONFIG, messages: MESSAGES, channel });
    await vi.waitFor(() => expect(stream.registered).toBe(true));
    stream.emit('message', { reply: '丢不掉的 ' });
    stream.emit('message', { reply: '回答' });
    stream.emit('end');

    await expect(pending).resolves.toEqual({ answer: '丢不掉的 回答', reasoning: '' });
    expect(channel.written).toEqual([
      encodeFrame('answer', '丢不掉的 '),
      encodeFrame('answer', '回答'),
    ]);
  });

  it('throws the error envelope when the stream emits an error event', async () => {
    const stream = createStreamMock();
    const manager = createManagerMock(stream, null);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pending = runModelCall({
      manager,
      config: CONFIG,
      messages: MESSAGES,
      channel: createChannelMock(),
    });
    await vi.waitFor(() => expect(stream.registered).toBe(true));
    stream.emit('error', new Error('upstream boom'));

    await expect(pending).rejects.toMatchObject({
      errCode: 'E_UPSTREAM_ERROR',
      errMsg: '模型服务暂时不可用',
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it('treats a non-emitter stream result as a full answer and pushes it once', async () => {
    const manager = createManagerMock({ reply: '整段兜底' }, null);
    const channel = createChannelMock();

    const { answer } = await runModelCall({
      manager,
      config: CONFIG,
      messages: MESSAGES,
      channel,
    });

    expect(answer).toBe('整段兜底');
    expect(channel.written).toEqual([encodeFrame('answer', '整段兜底')]);
  });

  it('keeps the stream alive while frames keep arriving within the idle window', async () => {
    vi.useFakeTimers();
    const stream = createStreamMock();
    const manager = createManagerMock(stream, null);
    const channel = createChannelMock();

    const pending = runModelCall({ manager, config: CONFIG, messages: MESSAGES, channel });
    await vi.advanceTimersByTimeAsync(1);
    expect(stream.registered).toBe(true);

    // 总虚拟时长远超旧的「总时长守卫」口径：只要帧间隔未超空闲窗口就不得中断
    for (let frame = 0; frame < 5; frame += 1) {
      stream.emit('message', { choices: [{ delta: { content: `第${frame}帧` } }] });
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_GUARD_MS - 1000);
    }
    stream.emit('end');

    await expect(pending).resolves.toEqual({
      answer: '第0帧第1帧第2帧第3帧第4帧',
      reasoning: '',
    });
  });

  it('errors when the stream stays silent beyond the idle window', async () => {
    vi.useFakeTimers();
    const stream = createStreamMock();
    const manager = createManagerMock(stream, null);
    const channel = createChannelMock();

    const pending = runModelCall({ manager, config: CONFIG, messages: MESSAGES, channel });
    await vi.advanceTimersByTimeAsync(1);
    const settled = pending.then(
      (value) => value,
      (rejection) => rejection,
    );
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_GUARD_MS + 1);

    await expect(settled).resolves.toMatchObject({
      errCode: 'E_UPSTREAM_ERROR',
      errMsg: '模型响应中断，请稍后重试',
    });
  });
});
