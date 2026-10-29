const WAMP_O_GRAM_PATH_PATTERN = /^\/wamp-o-gram\/([a-zA-Z0-9_-]{12,80})\/?$/;

export function buildWampOGramSharePath(slug: string): string {
  return `/wamp-o-gram/${encodeURIComponent(slug)}`;
}

/** Bump when the preview drawing changes: the API keeps each version's drawing for good (F348). */
export const WAMP_O_GRAM_PREVIEW_VERSION = '2';

/** The API path of a gram's link-preview image, carrying the preview renderer version. */
export function buildWampOGramPreviewPath(slug: string): string {
  return `/api/wamp-o-grams/${encodeURIComponent(slug)}/preview.png?renderer=${WAMP_O_GRAM_PREVIEW_VERSION}`;
}

export function buildWampOGramShareUrl(slug: string, href: string): string {
  const url = new URL(href);
  url.pathname = buildWampOGramSharePath(slug);
  url.search = '';
  url.hash = '';
  // Counted as the visit's source in the Launch Admin funnel (F127).
  url.searchParams.set('from', 'gram');
  return url.toString();
}

export function parseWampOGramSharePath(pathname: string): string | null {
  const match = WAMP_O_GRAM_PATH_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
