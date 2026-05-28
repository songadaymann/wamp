import { Resend } from 'resend';
import type { AuthUser } from '../../../auth/model';
import type { ChatMessageRecord } from '../../../chat/model';
import { normalizeProfileUsername, validateProfileUsername } from '../../../profiles/username';
import { DEFAULT_AUTH_EMAIL_FROM, findUserByUsername, resolvePublicBaseUrl } from '../auth/store';
import type { Env } from '../core/types';

const MAX_CHAT_MENTION_EMAILS = 5;
const CHAT_MENTION_TOKEN_PATTERN = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]{2,23})(?![A-Za-z0-9_-])/g;
const CHAT_EMAIL_BODY_MAX_LENGTH = 500;

export interface ChatMentionEmailResult {
  attempted: number;
  sent: number;
  skippedReason: string | null;
  errors: string[];
}

export function extractChatMentionUsernames(
  text: string,
  maxMentions: number = MAX_CHAT_MENTION_EMAILS
): string[] {
  const usernames = new Set<string>();

  for (const match of text.matchAll(CHAT_MENTION_TOKEN_PATTERN)) {
    const username = normalizeProfileUsername(match[2] ?? '');
    if (!username || validateProfileUsername(username)) {
      continue;
    }

    usernames.add(username);
    if (usernames.size >= maxMentions) {
      break;
    }
  }

  return [...usernames];
}

export async function sendChatMentionNotificationEmails(
  request: Request,
  env: Env,
  message: ChatMessageRecord,
  sender: AuthUser
): Promise<ChatMentionEmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: 'RESEND_API_KEY is not configured.',
      errors: [],
    };
  }

  const usernames = extractChatMentionUsernames(message.body);
  if (usernames.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: 'No valid @username mentions.',
      errors: [],
    };
  }

  const recipients = await loadChatMentionEmailRecipients(env, usernames, sender.id);
  if (recipients.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      skippedReason: 'No mentioned users have email addresses.',
      errors: [],
    };
  }

  const resend = new Resend(apiKey);
  const from = env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM;
  const baseUrl = resolvePublicBaseUrl(request, env).replace(/\/+$/, '');
  const chatUrl = `${baseUrl}/`;
  const excerpt = trimForEmail(message.body, CHAT_EMAIL_BODY_MAX_LENGTH);

  const results = await Promise.all(
    recipients.map(async (recipient) => {
      try {
        const response = await resend.emails.send({
          from,
          to: recipient.email,
          subject: `${sender.displayName} mentioned you in World Chat`,
          text: [
            `${sender.displayName} mentioned you in Everybody's Platformer World Chat:`,
            '',
            excerpt,
            '',
            `Open World Chat: ${chatUrl}`,
          ].join('\n'),
          html: [
            '<div style="font-family: monospace; background: #050505; color: #f3eee2; padding: 24px;">',
            '<h2 style="margin: 0 0 16px;">World Chat mention</h2>',
            `<p style="margin: 0 0 12px;"><strong>${escapeHtml(sender.displayName)}</strong> mentioned you in Everybody&apos;s Platformer World Chat:</p>`,
            `<blockquote style="margin: 0 0 20px; padding: 12px 14px; border-left: 4px solid #79ccde; background: #141414;">${escapeHtml(excerpt)}</blockquote>`,
            `<p style="margin: 0;"><a href="${escapeHtml(chatUrl)}" style="color: #7de5ff;">Open World Chat</a></p>`,
            '</div>',
          ].join(''),
        });

        if (response.error) {
          return {
            sent: false,
            error: response.error.message || `Email provider rejected @${recipient.username}.`,
          };
        }

        if (!response.data?.id) {
          return {
            sent: false,
            error: `Email provider did not return a message id for @${recipient.username}.`,
          };
        }

        return { sent: true, error: null };
      } catch (error) {
        return {
          sent: false,
          error: error instanceof Error
            ? error.message
            : `Unknown email provider failure for @${recipient.username}.`,
        };
      }
    })
  );

  return {
    attempted: recipients.length,
    sent: results.filter((result) => result.sent).length,
    skippedReason: null,
    errors: results
      .map((result) => result.error)
      .filter((error): error is string => Boolean(error)),
  };
}

export function logChatMentionEmailFailures(result: ChatMentionEmailResult): void {
  if (result.errors.length === 0) {
    return;
  }

  console.warn(`Chat mention emails sent ${result.sent}/${result.attempted}: ${result.errors.join('; ')}`);
}

async function loadChatMentionEmailRecipients(
  env: Env,
  usernames: string[],
  senderUserId: string
): Promise<Array<{
  userId: string;
  displayName: string;
  username: string;
  email: string;
}>> {
  const recipients = [];
  const seenUserIds = new Set<string>();

  for (const username of usernames) {
    const user = await findUserByUsername(env, username);
    const email = user?.email?.trim();
    if (!user || !email || user.id === senderUserId || seenUserIds.has(user.id)) {
      continue;
    }

    seenUserIds.add(user.id);
    recipients.push({
      userId: user.id,
      displayName: user.displayName,
      username: user.username ?? username,
      email,
    });
  }

  return recipients;
}

function trimForEmail(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
