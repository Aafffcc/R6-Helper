declare const agentCore: {
  DEFAULT_SYSTEM_PROMPT: string;
  requestModel(
    config: Record<string, string>,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string>;
  validateMessages(value: unknown): Array<{ role: string; content: string }>;
};

export = agentCore;
