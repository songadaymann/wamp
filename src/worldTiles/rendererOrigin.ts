const IMMUTABLE_PAGES_DEPLOYMENT_HOST_PATTERN =
  /^[a-f0-9]{8}\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pages\.dev$/i;

/**
 * Accept only Cloudflare Pages' immutable deployment hostname form.
 * Branch aliases and custom domains can be repointed and therefore cannot pin
 * a renderer contract for reproducible raster generation.
 */
export function normalizeImmutablePagesDeploymentOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
    || !IMMUTABLE_PAGES_DEPLOYMENT_HOST_PATTERN.test(url.hostname)
  ) {
    return null;
  }
  return url.origin;
}
