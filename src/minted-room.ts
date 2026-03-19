import { createPublicClient, getAddress, http } from 'viem';
import { base, baseSepolia, mainnet } from 'viem/chains';
import { parseRoomTokenMetadataUri } from './mint/roomMetadata';
import { renderWampMintedRoomToCanvas } from './mint/roomMetadataRender';
import {
  DEFAULT_ROOM_MINT_BLOCK_EXPLORER_URL,
  DEFAULT_ROOM_MINT_CHAIN_ID,
  ROOM_OWNERSHIP_TOKEN_ABI,
} from './mint/roomOwnership';

const titleEl = document.getElementById('minted-room-title');
const summaryEl = document.getElementById('minted-room-summary');
const metaEl = document.getElementById('minted-room-meta');
const previewStatusEl = document.getElementById('minted-room-preview-status');
const previewEl = document.getElementById('minted-room-preview');
const detailsEl = document.getElementById('minted-room-details');
const attributesEl = document.getElementById('minted-room-attributes');
const errorRootEl = document.getElementById('minted-room-error');
const errorTextEl = document.getElementById('minted-room-error-text');

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    const params = new URLSearchParams(window.location.search);
    const chainId = parsePositiveInt(params.get('chainId')) ?? DEFAULT_ROOM_MINT_CHAIN_ID;
    const contract = params.get('contract');
    const tokenId = params.get('tokenId');
    if (!contract || !tokenId) {
      throw new Error('Missing contract or tokenId in the URL.');
    }

    const chain = resolveChain(chainId);
    const client = createPublicClient({
      chain,
      transport: http(),
    });
    const contractAddress = getAddress(contract);
    summary(`Reading token #${tokenId} from ${chain.name}.`);

    const tokenUri = await client.readContract({
      address: contractAddress,
      abi: ROOM_OWNERSHIP_TOKEN_ABI,
      functionName: 'tokenURI',
      args: [BigInt(tokenId)],
    });
    const metadata = parseRoomTokenMetadataUri(tokenUri);
    const payload = metadata.wamp_room;

    if (titleEl) {
      titleEl.textContent = metadata.name || payload.title || `Room ${payload.coordinates[0]},${payload.coordinates[1]}`;
    }
    summary(metadata.description || 'Room metadata loaded from chain.');
    renderMeta([
      `Chain ${chain.name}`,
      `Room ${payload.roomId}`,
      `Version ${payload.version}`,
      payload.goal ? `Goal ${payload.goal.type}` : 'Goal none',
    ]);
    renderDetails({
      Contract: contractAddress,
      Token: tokenId,
      Room: payload.roomId,
      Coordinates: `${payload.coordinates[0]}, ${payload.coordinates[1]}`,
      Background: payload.background,
      Version: String(payload.version),
      Published: payload.publishedAt ?? 'Unknown',
      Animation: metadata.animation_url,
      Explorer: `${resolveExplorerBase(chainId)}/token/${contractAddress}?a=${tokenId}`,
    });
    renderAttributes(metadata.attributes.map((attribute) => {
      const suffix = attribute.display_type === 'number' ? '' : '';
      return `${attribute.trait_type}: ${attribute.value}${suffix}`;
    }));

    previewStatus('Rendering from the embedded wamp_room payload.');
    const canvas = await renderWampMintedRoomToCanvas(payload, {
      tilePixelSize: 6,
    });
    previewEl?.replaceChildren(canvas);
    previewStatus('Rendered from on-chain tokenURI metadata.');
  } catch (error) {
    console.error('Failed to render minted room', error);
    const message = error instanceof Error ? error.message : 'Unknown render failure.';
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
  return chainId === DEFAULT_ROOM_MINT_CHAIN_ID
    ? DEFAULT_ROOM_MINT_BLOCK_EXPLORER_URL
    : resolveChain(chainId).blockExplorers?.default.url ?? '';
}

function parsePositiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
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
    item.textContent = 'No attributes on this token.';
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
