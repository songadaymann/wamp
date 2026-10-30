import { createPublicClient, getAddress, http } from 'viem';
import { base, baseSepolia, mainnet } from 'viem/chains';
import { getRoomBackgroundLabel } from './backgrounds/model';
import { parseRoomTokenMetadataUri } from './mint/roomMetadata';
import { renderWampMintedRoomToCanvas } from './mint/roomMetadataRender';
import {
  ROOM_OWNERSHIP_TOKEN_ABI,
} from './mint/roomOwnership';
import { parseRoomChainId } from './mint/roomNetwork';
import { applyWalletGate } from './lib/wallet-gate.js';
import { hasCryptoWallet } from './mint/walletGate';
import { buildRoomTokenPlayUrl, parseRoomPreviewTokenId } from './mint/roomTokenLinks';
import './styles/tokens.css';
import './styles/sections/minted-room.css';
import './styles/sections/wallet-gate.css';

const titleEl = document.getElementById('minted-room-title');
const summaryEl = document.getElementById('minted-room-summary');
const metaEl = document.getElementById('minted-room-meta');
const previewStatusEl = document.getElementById('minted-room-preview-status');
const previewEl = document.getElementById('minted-room-preview');
const detailsEl = document.getElementById('minted-room-details');
const attributesEl = document.getElementById('minted-room-attributes');
const errorRootEl = document.getElementById('minted-room-error');
const errorTextEl = document.getElementById('minted-room-error-text');
const playEl = document.getElementById('minted-room-play');
const ownerEl = document.getElementById('minted-room-owner');

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    await applyWalletGate();
    const params = new URLSearchParams(window.location.search);
    const chainId = parseRoomChainId(params.get('chainId'));
    if (chainId === null) {
      throw new Error('This preview link is missing a valid network. Open the room from WAMP to get its full link.');
    }
    const contract = params.get('contract');
    const tokenIdText = params.get('tokenId');
    if (!contract || !tokenIdText) {
      throw new Error('Missing contract or tokenId in the URL.');
    }

    const chain = resolveChain(chainId);
    const tokenId = parseRoomPreviewTokenId(tokenIdText);
    const client = createPublicClient({
      chain,
      transport: http(undefined, { timeout: 8_000, retryCount: 0 }),
    });
    const contractAddress = getAddress(contract);
    summary(hasCryptoWallet() ? `Reading token #${tokenId} from ${chain.name}.` : 'Loading room preview...');

    const tokenUri = await client.readContract({
      address: contractAddress,
      abi: ROOM_OWNERSHIP_TOKEN_ABI,
      functionName: 'tokenURI',
      args: [tokenId],
    });
    const metadata = parseRoomTokenMetadataUri(tokenUri);
    const payload = metadata.wamp_room;
    const playUrl = buildRoomTokenPlayUrl(payload.coordinates);
    if (playEl instanceof HTMLAnchorElement) {
      playEl.href = playUrl;
      playEl.hidden = false;
    }
    observeOwner(chain, contractAddress, tokenId);

    if (titleEl) {
      titleEl.textContent = metadata.name || payload.title || `Room ${payload.coordinates[0]},${payload.coordinates[1]}`;
    }
    summary(metadata.description || 'A WAMP room preview.');
    renderMeta([
      `Chain ${chain.name}`,
      `Room ${payload.roomId}`,
      `Version ${payload.version}`,
      payload.goal ? `Goal ${payload.goal.type}` : 'Goal none',
    ]);
    renderDetails({
      Contract: contractAddress,
      Token: tokenId.toString(),
      Room: payload.roomId,
      Coordinates: `${payload.coordinates[0]}, ${payload.coordinates[1]}`,
      Background: getRoomBackgroundLabel(payload.background),
      Version: String(payload.version),
      Published: payload.publishedAt ?? 'Unknown',
      Animation: metadata.animation_url,
      Explorer: `${resolveExplorerBase(chainId)}/token/${contractAddress}?a=${tokenId}`,
    });
    renderAttributes(metadata.attributes.map((attribute) => {
      return `${attribute.trait_type}: ${attribute.value}`;
    }));

    previewStatus('Rendering room preview...');
    const canvas = await renderWampMintedRoomToCanvas(payload, {
      tilePixelSize: 16,
    });
    previewEl?.replaceChildren(canvas);
    previewStatus(hasCryptoWallet() ? 'Rendered from on-chain tokenURI metadata.' : 'Room preview ready.');
  } catch (error) {
    console.error('Failed to render minted room', error);
    if (titleEl) titleEl.textContent = 'Preview unavailable';
    const message = hasCryptoWallet() ? error instanceof Error ? error.message : 'Unknown render failure.'
      : 'This room preview is unavailable. Open the room in WAMP for a fresh link.';
    if (errorRootEl) {
      errorRootEl.classList.remove('hidden');
    }
    if (errorTextEl) {
      errorTextEl.textContent = message;
    }
    summary(message);
    previewStatus('Preview unavailable.');
  }
}

function resolveChain(chainId: number) {
  switch (chainId) {
    case base.id:
      return base;
    case baseSepolia.id:
      return baseSepolia;
    case mainnet.id:
      return mainnet;
    default:
      throw new Error(`Unsupported chain ${chainId}.`);
  }
}

function resolveExplorerBase(chainId: number): string {
  return resolveChain(chainId).blockExplorers?.default.url ?? '';
}

function observeOwner(chain: ReturnType<typeof resolveChain>, contract: `0x${string}`, tokenId: bigint): void {
  let active: AbortController | null = null;
  let enabled = false;
  let suspended = false;
  const refresh = () => {
    const nextEnabled = !suspended && hasCryptoWallet();
    if (nextEnabled === enabled) return;
    enabled = nextEnabled;
    active?.abort();
    active = null;
    ownerEl?.replaceChildren();
    if (!enabled || !ownerEl) return;
    const request = new AbortController();
    active = request;
    ownerEl.textContent = 'Reading owner…';
    const client = createPublicClient({ chain, transport: http(undefined, {
      timeout: 8_000, retryCount: 0, fetchOptions: { signal: request.signal },
    }) });
    void client.readContract({ address: contract, abi: ROOM_OWNERSHIP_TOKEN_ABI,
      functionName: 'ownerOf', args: [tokenId] }).then(owner => {
      if (active !== request || request.signal.aborted || !hasCryptoWallet()) return;
      const link = document.createElement('a');
      link.href = `${resolveExplorerBase(chain.id)}/address/${owner}`;
      link.textContent = owner;
      ownerEl.replaceChildren(document.createTextNode('Owned by '), link);
    }).catch(() => {
      if (active === request && !request.signal.aborted && hasCryptoWallet()) {
        ownerEl.textContent = 'Owner unavailable';
      }
    });
  };
  window.addEventListener('wallet-gate', refresh);
  window.addEventListener('pagehide', () => {
    suspended = true;
    refresh();
  });
  window.addEventListener('pageshow', () => {
    suspended = false;
    refresh();
  });
  refresh();
}

function summary(text: string): void {
  if (summaryEl) {
    summaryEl.textContent = text;
  }
}

function previewStatus(text: string): void {
  if (previewStatusEl) {
    previewStatusEl.textContent = text;
  }
}

function renderMeta(values: string[]): void {
  if (!metaEl) {
    return;
  }

  metaEl.replaceChildren(
    ...values.map((value) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      if (value.startsWith('Chain ')) chip.dataset.crypto = '';
      chip.textContent = value;
      return chip;
    }),
  );
}

function renderDetails(entries: Record<string, string>): void {
  if (!detailsEl) {
    return;
  }

  detailsEl.replaceChildren(
    ...Object.entries(entries).flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      if (['Contract', 'Token', 'Animation', 'Explorer'].includes(label)) {
        dt.dataset.crypto = ''; dd.dataset.crypto = '';
      }
      if (/^https?:\/\//.test(value)) {
        const link = document.createElement('a');
        link.href = value;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = value;
        dd.appendChild(link);
      } else {
        dd.textContent = value;
      }
      return [dt, dd];
    }),
  );
}

function renderAttributes(entries: string[]): void {
  if (!attributesEl) {
    return;
  }

  if (entries.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No room facts available.';
    attributesEl.replaceChildren(item);
    return;
  }

  attributesEl.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement('li');
      item.textContent = entry;
      return item;
    }),
  );
}
