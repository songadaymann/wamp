import type { BrowseRoomCommentPreview } from './model';

export function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatCommentCount(count: number): string {
  return count === 1 ? '1 comment' : `${count} comments`;
}

export function truncateCommentBody(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function getCommentsSignature(
  comments: readonly BrowseRoomCommentPreview[],
  commentCount = comments.length,
): string {
  return JSON.stringify([commentCount, comments.map(comment => [comment.id, comment.createdAt,
    comment.body, comment.authorDisplayName, comment.authorUsername ?? null])]);
}
