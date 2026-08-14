import { apiRequest } from '../api/request';
import type { MagicLinkRequestResponse } from './model';

export interface EmailMagicLinkOptions {
  returnTo?: string;
}

export async function requestEmailMagicLink(
  email: string,
  options: EmailMagicLinkOptions = {},
): Promise<MagicLinkRequestResponse> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidEmailAddress(normalizedEmail)) {
    throw new Error('Please enter a valid email address.');
  }

  return apiRequest<MagicLinkRequestResponse>('/api/auth/request-link', {
    method: 'POST',
    body: JSON.stringify({
      email: normalizedEmail,
      ...(options.returnTo ? { returnTo: options.returnTo } : {}),
    }),
  });
}

export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function buildTutorialAccountReturnUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('tutorial');
  url.searchParams.delete('auth');
  return url.toString();
}
