export interface BrowserWalletConnector {
  id?: string;
  info?: {
    rdns?: string | null;
  };
}

export interface InjectedBrowserProvider {
  isMetaMask?: boolean;
  isRabby?: boolean;
  isRainbow?: boolean;
  isZerion?: boolean;
  isBraveWallet?: boolean;
  isPhantom?: boolean;
  isCoinbaseWallet?: boolean;
  isOkxWallet?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  providers?: InjectedBrowserProvider[];
}

export interface BrowserWalletInstallInput {
  ids?: string[];
  announcedRdns: readonly string[];
  connectorIds: readonly string[];
  ethereum?: InjectedBrowserProvider | null;
}

const announcedRdns = new Set<string>();
let discoveryStarted = false;

const legacyRdnsMatchers: Record<string, (provider: InjectedBrowserProvider) => boolean> = {
  'io.metamask': (provider) =>
    Boolean(provider.isMetaMask) &&
    !provider.isBraveWallet &&
    !provider.isRabby &&
    !provider.isPhantom &&
    !provider.isCoinbaseWallet &&
    !provider.isOkxWallet &&
    !provider.isTrust &&
    !provider.isTrustWallet,
  'io.rabby': (provider) => Boolean(provider.isRabby),
  'me.rainbow': (provider) => Boolean(provider.isRainbow),
  'io.zerion.wallet': (provider) => Boolean(provider.isZerion),
};

export function startBrowserWalletDiscovery(): void {
  if (discoveryStarted || typeof window === 'undefined') {
    return;
  }

  discoveryStarted = true;
  window.addEventListener('eip6963:announceProvider', (event) => {
    const rdns = (event as CustomEvent<{ info?: { rdns?: string } }>).detail?.info?.rdns;
    if (rdns) {
      announcedRdns.add(rdns);
    }
  });
  requestBrowserWalletProviders();
}

export function requestBrowserWalletProviders(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function getAnnouncedBrowserWalletRdns(): string[] {
  return [...announcedRdns];
}

export function collectConnectorWalletIds(connectors: readonly BrowserWalletConnector[]): string[] {
  const ids = new Set<string>();
  for (const connector of connectors) {
    if (connector.id) {
      ids.add(connector.id);
    }
    if (connector.info?.rdns) {
      ids.add(connector.info.rdns);
    }
  }
  return [...ids];
}

export function isBrowserWalletInstalled({
  ids,
  announcedRdns: announced,
  connectorIds,
  ethereum,
}: BrowserWalletInstallInput): boolean {
  if (!ids?.length) {
    return announced.length > 0;
  }

  const providers = listInjectedProviders(ethereum);
  return ids.some(
    (id) =>
      announced.includes(id) ||
      connectorIds.includes(id) ||
      providers.some((provider) => legacyRdnsMatchers[id]?.(provider) === true),
  );
}

function listInjectedProviders(
  ethereum: InjectedBrowserProvider | null | undefined,
): InjectedBrowserProvider[] {
  if (!ethereum) {
    return [];
  }

  const nested = Array.isArray(ethereum.providers) ? ethereum.providers : [];
  return [ethereum, ...nested];
}
