import type { Env } from '../core/types';
import { DEFAULT_AUTH_EMAIL_FROM } from '../auth/store';

export interface EmailMessage { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }
export function escapeEmailHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export async function deliverEmail(env: Env, message: EmailMessage, idempotencyKey: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM, ...message }),
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== 'string' || !result.id) throw new Error('Email provider did not return a message id.');
  return result.id;
}
