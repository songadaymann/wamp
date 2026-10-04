import { describe, expect, it } from 'vitest';
import {
  collectConnectorWalletIds,
  isBrowserWalletInstalled,
  type InjectedBrowserProvider,
} from './browserWallets';

const metamask: InjectedBrowserProvider = { isMetaMask: true };
const rabbyPretending: InjectedBrowserProvider = { isMetaMask: true, isRabby: true };

describe('browser wallet install detection', () => {
  it('treats an announced MetaMask rdns as installed', () => {
    expect(
      isBrowserWalletInstalled({
        ids: ['io.metamask'],
        announcedRdns: ['io.metamask'],
        connectorIds: [],
        ethereum: undefined,
      }),
    ).toBe(true);
  });

  it('treats a connector id that matches the wallet rdns as installed', () => {
    expect(
      isBrowserWalletInstalled({
        ids: ['io.metamask'],
        announcedRdns: [],
        connectorIds: collectConnectorWalletIds([{ id: 'io.metamask', info: { rdns: 'io.metamask' } }]),
        ethereum: undefined,
      }),
    ).toBe(true);
  });

  it('recognizes the legacy MetaMask provider, including when another wallet owns window.ethereum', () => {
    expect(
      isBrowserWalletInstalled({
        ids: ['io.metamask'],
        announcedRdns: [],
        connectorIds: [],
        ethereum: metamask,
      }),
    ).toBe(true);

    expect(
      isBrowserWalletInstalled({
        ids: ['io.metamask'],
        announcedRdns: [],
        connectorIds: [],
        ethereum: { isRabby: true, providers: [rabbyPretending, metamask] },
      }),
    ).toBe(true);
  });

  it('does not treat another wallet that sets isMetaMask as MetaMask', () => {
    expect(
      isBrowserWalletInstalled({
        ids: ['io.metamask'],
        announcedRdns: [],
        connectorIds: [],
        ethereum: rabbyPretending,
      }),
    ).toBe(false);

    expect(
      isBrowserWalletInstalled({
        ids: ['io.rabby'],
        announcedRdns: [],
        connectorIds: [],
        ethereum: rabbyPretending,
      }),
    ).toBe(true);
  });

  it('leaves the generic injected connector out of a specific wallet check', () => {
    expect(
      isBrowserWalletInstalled({
        ids: ['io.metamask'],
        announcedRdns: [],
        connectorIds: collectConnectorWalletIds([{ id: 'injected' }, { id: 'walletConnect' }]),
        ethereum: undefined,
      }),
    ).toBe(false);

    expect(
      isBrowserWalletInstalled({
        ids: undefined,
        announcedRdns: [],
        connectorIds: ['injected'],
        ethereum: undefined,
      }),
    ).toBe(false);
  });

  it('reports no browser wallet when nothing is injected', () => {
    expect(
      isBrowserWalletInstalled({
        ids: ['io.metamask'],
        announcedRdns: [],
        connectorIds: [],
        ethereum: undefined,
      }),
    ).toBe(false);
  });
});
