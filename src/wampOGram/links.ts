const WAMP_O_GRAM_PATH_PATTERN = /^\/wamp-o-gram\/([a-zA-Z0-9_-]{12,80})\/?$/;

export function buildWampOGramSharePath(slug: string): string {
  return `/wamp-o-gram/${encodeURIComponent(slug)}`;
}

export function buildWampOGramShareUrl(slug: string, href: string): string {
  const url = new URL(href);
  url.pathname = buildWampOGramSharePath(slug);
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function parseWampOGramSharePath(pathname: string): string | null {
  const match = WAMP_O_GRAM_PATH_PATTERN.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
