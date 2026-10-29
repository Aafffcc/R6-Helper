declare const agentCore: {
  DEFAULT_SYSTEM_PROMPT: string;
  /** 流式帧间空闲守卫（毫秒）：每帧重置，连续无帧达到该值才判定上游中断 */
  STREAM_IDLE_GUARD_MS: number;
  MAX_OUTPUT_TOKENS: number;
  FRAME_TYPES: { THINK: 'think'; ANSWER: 'answer' };
  createChatOptions(
    config: Record<string, string>,
    messages: Array<{ role: string; content: string }>,
  ): Record<string, unknown>;
  encodeFrame(type: 'think' | 'answer', text: string): string;
  error(errCode: string, errMsg: string): { errCode: string; errMsg: string };
  extractReasoning(chunk: unknown): string;
  extractText(chunk: unknown): string;
  runModelCall(input: {
    manager: unknown;
    config: Record<string, string>;
    messages: Array<{ role: string; content: string }>;
    channel?: unknown;
  }): Promise<{ answer: string; reasoning: string }>;
  validateMessages(value: unknown): Array<{ role: string; content: string }>;
};

export = agentCore;
