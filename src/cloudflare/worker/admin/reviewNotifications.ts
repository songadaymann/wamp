import { Resend } from 'resend';
import { DEFAULT_AUTH_EMAIL_FROM, resolvePublicBaseUrl } from '../auth/store';
import type { Env } from '../core/types';

const DEFAULT_ADMIN_REVIEW_EMAIL = 'jonathan@jonathanmann.net';

export interface AdminReviewNotificationEmailResult {
  attempted: boolean;
  sent: boolean;
  skippedReason: string | null;
  error: string | null;
}

interface AdminReviewNotificationEmail {
  subject: string;
  heading: string;
  intro: string;
  details: string[];
  actionUrl: string;
  actionLabel: string;
}

export async function sendAdminReviewNotificationEmail(
  env: Env,
  email: AdminReviewNotificationEmail,
): Promise<AdminReviewNotificationEmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      attempted: false,
      sent: false,
      skippedReason: 'RESEND_API_KEY is not configured.',
      error: null,
    };
  }

  const to = env.ADMIN_REVIEW_EMAIL?.trim() || DEFAULT_ADMIN_REVIEW_EMAIL;
  const resend = new Resend(apiKey);
  const from = env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM;
  try {
    const response = await resend.emails.send({
      from,
      to,
      subject: email.subject,
      text: [
        email.heading,
        '',
        email.intro,
        '',
        ...email.details,
        '',
        `${email.actionLabel}: ${email.actionUrl}`,
      ].join('\n'),
      html: [
        '<div style="font-family: monospace; background: #050505; color: #f3eee2; padding: 24px;">',
        `<h2 style="margin: 0 0 16px;">${escapeHtml(email.heading)}</h2>`,
        `<p style="margin: 0 0 16px;">${escapeHtml(email.intro)}</p>`,
        '<ul style="margin: 0 0 20px; padding-left: 20px;">',
        ...email.details.map((detail) => `<li style="margin: 0 0 8px;">${escapeHtml(detail)}</li>`),
        '</ul>',
        `<p style="margin: 0;"><a href="${escapeHtml(email.actionUrl)}" style="color: #7de5ff;">${escapeHtml(email.actionLabel)}</a></p>`,
        '</div>',
      ].join(''),
    });

    if (response.error) {
      return {
        attempted: true,
        sent: false,
        skippedReason: null,
        error: response.error.message || 'Email provider rejected the request.',
      };
    }

    if (!response.data?.id) {
      return {
        attempted: true,
        sent: false,
        skippedReason: null,
        error: 'Email provider did not return a message id.',
      };
    }

    return {
      attempted: true,
      sent: true,
      skippedReason: null,
      error: null,
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      skippedReason: null,
      error: error instanceof Error ? error.message : 'Unknown email provider failure.',
    };
  }
}

export function buildAdminReviewUrl(
  request: Request,
  env: Env,
  path: '/background-admin.html' | '/launch-admin.html',
): string {
  return buildPublicAppUrl(request, env, path);
}

export function buildPublicAppUrl(
  request: Request,
  env: Env,
  path: string,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${resolvePublicBaseUrl(request, env).replace(/\/+$/, '')}${normalizedPath}`;
}

export function logAdminReviewNotificationFailure(
  result: AdminReviewNotificationEmailResult,
  context: string,
): void {
  if (result.sent) {
    return;
  }

  const reason = result.error ?? result.skippedReason;
  if (reason) {
    console.warn(`Admin review notification not sent for ${context}: ${reason}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
