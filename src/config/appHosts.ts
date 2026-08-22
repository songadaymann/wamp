const PRODUCTION_API_BASE = 'https://api.wamp.land';
const CLOUDFLARE_ACCOUNT_WORKERS_SUFFIX = 'novox-robot.workers.dev';
const WORKER_NAMES = ['everybodys-platformer-safety', 'everybodys-platformer'] as const;
const PAGES_PROJECT_HOSTS = [
  'wampland.pages.dev',
  'wamp.pages.dev',
  'wamp-9i6.pages.dev',
] as const;

export function isTrustedPagesHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return PAGES_PROJECT_HOSTS.some((project) => host === project || host.endsWith(`.${project}`));
}

export function isTrustedWorkersHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  for (const workerName of WORKER_NAMES) {
    const canonical = `${workerName}.${CLOUDFLARE_ACCOUNT_WORKERS_SUFFIX}`;
    if (host === canonical || host.endsWith(`-${canonical}`) || host.endsWith(`.${canonical}`)) {
      return true;
    }
  }
  return false;
}

export function isTrustedAppHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'wamp.land' ||
    host === 'www.wamp.land' ||
    host === 'api.wamp.land' ||
    isTrustedWorkersHostname(host) ||
    isTrustedPagesHostname(host)
  );
}

export function getKnownProductionApiBase(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host === 'wamp.land' || host === 'www.wamp.land' || isTrustedPagesHostname(host)) {
    return PRODUCTION_API_BASE;
  }
  return '';
}
