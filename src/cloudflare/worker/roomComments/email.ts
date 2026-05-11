import { Resend } from 'resend';
import type { AdminRoomCommentRecord } from '../../../roomComments/model';
import { DEFAULT_AUTH_EMAIL_FROM, resolvePublicBaseUrl } from '../auth/store';
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
  if (!env.RESEND_API_KEY?.trim()) {
    return {
      attempted: false,
      sent: false,
      skippedReason: 'RESEND_API_KEY is not configured.',
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
  const baseUrl = resolvePublicBaseUrl(request, env).replace(/\/+$/, '');
  const roomUrl = `${baseUrl}/r/${comment.roomCoordinates.x}/${comment.roomCoordinates.y}`;
  const resend = new Resend(env.RESEND_API_KEY);
  const from = env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_EMAIL_FROM;

  const response = await resend.emails.send({
    from,
    to: comment.builderEmail,
    subject: `New approved comment on ${roomLabel}`,
    text: [
      `${comment.authorDisplayName} left a comment on ${roomLabel}:`,
      '',
      comment.body,
      '',
      `View the room: ${roomUrl}`,
    ].join('\n'),
    html: [
      '<div style="font-family: monospace; background: #050505; color: #f3eee2; padding: 24px;">',
      `<h2 style="margin: 0 0 16px;">New comment on ${escapeHtml(roomLabel)}</h2>`,
      `<p style="margin: 0 0 12px;"><strong>${escapeHtml(comment.authorDisplayName)}</strong> said:</p>`,
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
