export const PROFILE_USERNAME_MIN_LENGTH = 3;
export const PROFILE_USERNAME_MAX_LENGTH = 24;

const PROFILE_USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,23}$/;

const RESERVED_PROFILE_USERNAMES = new Set([
  'admin',
  'agent',
  'agents',
  'api',
  'app',
  'auth',
  'background-admin',
  'build',
  'course',
  'courses',
  'dashboard',
  'edit',
  'explore',
  'favicon',
  'help',
  'index',
  'launch-admin',
  'leaderboard',
  'leaderboards',
  'me',
  'mint',
  'minted-room',
  'new',
  'play',
  'profile',
  'profiles',
  'r',
  'room',
  'rooms',
  'settings',
  'share',
  'skill',
  'static',
  'support',
  'suspicious-admin',
  'u',
  'user',
  'users',
  'wamp',
  'www',
]);

export function normalizeProfileUsername(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/^@+/, '').toLowerCase();
}

export function validateProfileUsername(username: string): string | null {
  const normalized = normalizeProfileUsername(username);
  if (!normalized) {
    return 'Username is required.';
  }

  if (normalized.length < PROFILE_USERNAME_MIN_LENGTH || normalized.length > PROFILE_USERNAME_MAX_LENGTH) {
    return `Username must be ${PROFILE_USERNAME_MIN_LENGTH}-${PROFILE_USERNAME_MAX_LENGTH} characters.`;
  }

  if (!PROFILE_USERNAME_PATTERN.test(normalized)) {
    return 'Username can only use lowercase letters, numbers, underscores, and hyphens.';
  }

  if (isReservedProfileUsername(normalized)) {
    return 'That username is reserved.';
  }

  return null;
}

export function isReservedProfileUsername(username: string): boolean {
  return RESERVED_PROFILE_USERNAMES.has(normalizeProfileUsername(username));
}

export function deriveProfileUsernameBase(displayName: string, fallback = 'player'): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, PROFILE_USERNAME_MAX_LENGTH);

  if (slug.length >= PROFILE_USERNAME_MIN_LENGTH && !isReservedProfileUsername(slug)) {
    return slug;
  }

  const normalizedFallback = fallback
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, PROFILE_USERNAME_MAX_LENGTH);
  return normalizedFallback.length >= PROFILE_USERNAME_MIN_LENGTH ? normalizedFallback : 'player';
}

export function parseProfileSharePath(pathname: string): string | null {
  const normalizedPath = pathname.trim();
  const match = /^\/([^/]+)\/?$/.exec(normalizedPath);
  if (!match) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1] ?? '');
  } catch {
    return null;
  }

  const username = normalizeProfileUsername(decoded);
  return validateProfileUsername(username) ? null : username;
}

export function buildProfileSharePath(username: string): string {
  return `/${encodeURIComponent(normalizeProfileUsername(username))}`;
}

export function buildProfileShareUrl(username: string, href: string): string {
  const url = new URL(href);
  url.pathname = buildProfileSharePath(username);
  url.search = '';
  url.hash = '';
  return url.toString();
}
