import { Resend } from 'resend';
import type { Env } from '../core/types';

type Message = { from: string; to: string | string[]; subject: string; text: string; html: string; headers?: Record<string, string> };
type SendResult = { data: { id: string } | null; error: { message: string; statusCode?: number | null } | null };

export function emailConfigured(env: Env): boolean {
  return Boolean(env.EMAIL || env.RESEND_API_KEY?.trim());
}

/** Prefer the native binding. Never retry a failed native send through another provider. */
export function createEmailClient(env: Env): { emails: { send(message: Message): Promise<SendResult> } } {
  const binding = env.EMAIL;
  if (!binding) return new Resend(env.RESEND_API_KEY);
  return { emails: { async send(message) {
    try {
      const from = parseSender(env.EMAIL_FROM?.trim() || message.from);
      const result = await binding.send({ ...message, from });
      if (!result.messageId) return { data: null, error: { message: 'Email provider did not return a message id.' } };
      return { data: { id: result.messageId }, error: null };
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      return { data: null, error: {
        message: error instanceof Error ? error.message : 'Email delivery failed.',
        statusCode: code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED' ? 429 : 502,
      } };
    }
  } } };
}

function parseSender(value: string): string | { email: string; name?: string } {
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(value.trim());
  return match ? { email: match[2].trim(), name: match[1].trim().replace(/^"|"$/g, '') } : value.trim();
}
