declare const __WAMP_PUBLIC_ASSET_HASHES__: Readonly<Record<string, string>>;

export function getPublicAssetHashes(): Readonly<Record<string, string>> {
  return typeof __WAMP_PUBLIC_ASSET_HASHES__ === 'undefined' ? {} : __WAMP_PUBLIC_ASSET_HASHES__;
}

/** Content versions belong at load time: saved GIDs and world-renderer contracts stay stable. */
export function assetUrl(path: string, hashes = getPublicAssetHashes()): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return path;
  const fragmentAt = path.indexOf('#');
  const fragment = fragmentAt < 0 ? '' : path.slice(fragmentAt);
  const withoutFragment = fragmentAt < 0 ? path : path.slice(0, fragmentAt);
  const queryAt = withoutFragment.indexOf('?');
  const pathname = queryAt < 0 ? withoutFragment : withoutFragment.slice(0, queryAt);
  let key: string;
  try { key = decodeURIComponent(pathname).replace(/^(?:\.\/|\/)+/, ''); }
  catch { return path; }
  if (!key.startsWith('assets/')) return path;
  const hash = hashes[key];
  if (!hash) return path;
  const query = new URLSearchParams(queryAt < 0 ? '' : withoutFragment.slice(queryAt + 1));
  query.set('v', hash);
  return `${pathname}?${query.toString()}${fragment}`;
}

export function isContentVersionedAsset(pathname: string, version: string | null, hashes = getPublicAssetHashes()): boolean {
  let key: string;
  try { key = decodeURIComponent(pathname).replace(/^\/+/, ''); }
  catch { return false; }
  return Boolean(version && hashes[key] === version);
}
