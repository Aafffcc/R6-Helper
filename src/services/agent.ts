import { callCloudObject } from './cloud';
import { AppError } from '@/types/errors';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function askAgent(messages: AgentMessage[]): Promise<string> {
  const result = await callCloudObject<{ answer?: unknown }>('agent', 'chat', { messages });
  if (typeof result?.answer !== 'string' || result.answer.trim() === '') {
    throw new AppError('E_UNKNOWN', 'Agent 返回的回答为空');
  }
  return result.answer.trim();
}
