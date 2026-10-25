import { formatAccountIdentity } from '../../../auth/displayIdentity';
import { createEmailClient, emailConfigured } from '../email/provider';
import { escapeEmailHtml as escapeHtml } from '../email/delivery';
import type { AdminRoomCommentRecord } from '../../../roomComments/model';
import { DEFAULT_AUTH_EMAIL_FROM, resolveEmailBaseUrl } from '../auth/store';
import type { Env } from '../core/types';

export interface RoomCommentEmailResult {
  attempted: boolean;
  sent: boolean;
  skippedReason: string | null;
  error: string | null;
}

export async function sendRoomCommentApprovedEmail(
  request: Request,
  env: Env,
  comment: AdminRoomCommentRecord,
): Promise<RoomCommentEmailResult> {
  if (!emailConfigured(env)) {
    return {
      attempted: false,
      sent: false,
      skippedReason: 'Email delivery is not configured.',
      error: null,
    };
  }

  if (!comment.builderEmail?.trim()) {
    return {
      attempted: false,
      sent: false,
      skippedReason: 'The builder does not have an email address.',
      error: null,
    };
  }

  if (comment.builderUserId && comment.builderUserId === comment.authorUserId) {
    return {
      attempted: false,
      sent: false,
      skippedReason: 'Comment author is the room builder.',
      error: null,
    };
  }

  const roomLabel =
    comment.roomTitle?.trim()
      ? `"${comment.roomTitle.trim()}"`
      : `Room ${comment.roomCoordinates.x},${comment.roomCoordinates.y}`;
  const baseUrl = resolveEmailBaseUrl(request, env).replace(/\/+$/, '');
  const roomUrl = `${baseUrl}/r/${comment.roomCoordinates.x}/${comment.roomCoordinates.y}`;
  const mailer = createEmailClient(env);
  const from = env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM;

  const response = await mailer.emails.send({
    from,
    to: comment.builderEmail,
    subject: `New approved comment on ${roomLabel}`,
    text: [
      `${formatAccountIdentity(comment.authorDisplayName, comment.authorUsername)} left a comment on ${roomLabel}:`,
      '',
      comment.body,
      '',
      `View the room: ${roomUrl}`,
    ].join('\n'),
    html: [
      '<div style="font-family: monospace; background: #050505; color: #f3eee2; padding: 24px;">',
      `<h2 style="margin: 0 0 16px;">New comment on ${escapeHtml(roomLabel)}</h2>`,
      `<p style="margin: 0 0 12px;"><strong>${escapeHtml(formatAccountIdentity(comment.authorDisplayName, comment.authorUsername))}</strong> said:</p>`,
      `<blockquote style="margin: 0 0 20px; padding: 12px 14px; border-left: 4px solid #f2c84b; background: #141414;">${escapeHtml(comment.body)}</blockquote>`,
      `<p style="margin: 0;"><a href="${escapeHtml(roomUrl)}" style="color: #7de5ff;">Open the room</a></p>`,
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
}
