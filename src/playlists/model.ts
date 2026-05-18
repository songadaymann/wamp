import type { RoomGoalType } from '../goals/roomGoals';
import type { RoomCoordinates } from '../persistence/roomModel';

export const PLAYLIST_TITLE_MAX_LENGTH = 60;
export const PLAYLIST_DESCRIPTION_MAX_LENGTH = 280;
export const PLAYLIST_SLUG_MIN_LENGTH = 3;
export const PLAYLIST_SLUG_MAX_LENGTH = 48;

const PLAYLIST_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,47}$/;

export interface RoomPlaylistSummary {
  id: string;
  ownerUserId: string;
  ownerDisplayName: string;
  ownerUsername: string | null;
  title: string;
  slug: string;
  description: string | null;
  roomCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomPlaylistItem {
  id: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomTitle: string | null;
  roomVersion: number;
  goalType: RoomGoalType | null;
  publishedAt: string | null;
  position: number;
  addedAt: string;
}

export interface RoomPlaylistResponse extends RoomPlaylistSummary {
  viewerCanEdit: boolean;
  items: RoomPlaylistItem[];
}

export interface RoomPlaylistListResponse {
  playlists: RoomPlaylistSummary[];
}

export interface RoomPlaylistCreateRequestBody {
  title: string;
  slug?: string | null;
  description?: string | null;
}

export interface RoomPlaylistUpdateRequestBody {
  title?: string;
  slug?: string | null;
  description?: string | null;
}

export interface RoomPlaylistItemCreateRequestBody {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomVersion: number;
}

export function normalizePlaylistTitle(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizePlaylistDescription(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\r\n/g, '\n').trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizePlaylistSlug(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PLAYLIST_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

export function derivePlaylistSlugBase(title: string, fallback = 'playlist'): string {
  const slug = normalizePlaylistSlug(title);
  if (slug.length >= PLAYLIST_SLUG_MIN_LENGTH) {
    return slug;
  }
  return fallback;
}

export function validatePlaylistTitle(title: string): string | null {
  if (!title) {
    return 'Playlist title is required.';
  }
  if (title.length > PLAYLIST_TITLE_MAX_LENGTH) {
    return `Playlist title must be ${PLAYLIST_TITLE_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

export function validatePlaylistDescription(description: string | null): string | null {
  if (description && description.length > PLAYLIST_DESCRIPTION_MAX_LENGTH) {
    return `Playlist description must be ${PLAYLIST_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

export function validatePlaylistSlug(slug: string): string | null {
  if (!slug) {
    return 'Playlist URL name is required.';
  }
  if (slug.length < PLAYLIST_SLUG_MIN_LENGTH || slug.length > PLAYLIST_SLUG_MAX_LENGTH) {
    return `Playlist URL name must be ${PLAYLIST_SLUG_MIN_LENGTH}-${PLAYLIST_SLUG_MAX_LENGTH} characters.`;
  }
  if (!PLAYLIST_SLUG_PATTERN.test(slug)) {
    return 'Playlist URL name can only use lowercase letters, numbers, and hyphens.';
  }
  return null;
}

export function parsePlaylistSharePath(pathname: string): string | null {
  const normalizedPath = pathname.trim();
  const match = /^\/playlist\/([^/]+)\/?$/.exec(normalizedPath);
  if (!match) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1] ?? '');
  } catch {
    return null;
  }

  const slug = normalizePlaylistSlug(decoded);
  return validatePlaylistSlug(slug) ? null : slug;
}

export function buildPlaylistSharePath(slug: string): string {
  return `/playlist/${encodeURIComponent(normalizePlaylistSlug(slug))}`;
}

export function buildPlaylistShareUrl(slug: string, href: string): string {
  const url = new URL(href);
  url.pathname = buildPlaylistSharePath(slug);
  url.search = '';
  url.hash = '';
  return url.toString();
}
