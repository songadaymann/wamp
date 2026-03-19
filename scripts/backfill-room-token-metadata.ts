import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { ROOM_OWNERSHIP_TOKEN_ABI } from '../src/mint/roomOwnership';
import { buildRoomTokenMetadata } from '../src/mint/roomMetadata';

const CONTRACT = '0xc3032d5e67c8a67c9745943929f8dff2410dd9a1' as const;
const ORIGIN = 'https://wamp.land';
const API_BASE = 'https://api.wamp.land';
const ROOM_PREVIEW_RENDER_ORIGIN = process.env.ROOM_PREVIEW_RENDER_ORIGIN?.trim() || ORIGIN;
const WRITE_ENABLED = process.argv.includes('--write');
const ALLOW_FALLBACK_IMAGE = process.argv.includes('--allow-fallback-image');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const onlyTokenIds = new Set(
  (onlyArg?.slice('--only='.length).split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
);

dns.setDefaultResultOrder('ipv4first');

const privateKey = process.env.PRIVATE_KEY?.trim() ?? '';
const rpcUrl = process.env.ROOM_MINT_RPC_URL?.trim() ?? '';

if (!privateKey || !rpcUrl) {
  throw new Error('PRIVATE_KEY and ROOM_MINT_RPC_URL must be present in the environment.');
}

const account = privateKeyToAccount(
  (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`
);
const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(rpcUrl),
});
const ownerAbi = [
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const renderHelperUrl = pathToFileURL(resolve(scriptDir, 'render-room-preview-data-url.mjs')).href;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildFallbackSvg(room: any): string {
  const title =
    typeof room.title === 'string' && room.title.trim()
      ? room.title.trim()
      : `Room ${room.coordinates.x},${room.coordinates.y}`;
  const goal = room.goal?.type ? String(room.goal.type).replace(/_/g, ' ') : 'No goal';
  const bg = room.background || 'none';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="352" viewBox="0 0 640 352">` +
    `<rect width="640" height="352" fill="#090b12"/>` +
    `<rect x="18" y="18" width="604" height="316" rx="14" fill="#121725" stroke="#f5f1de" stroke-opacity="0.25"/>` +
    `<text x="40" y="78" fill="#f5f1de" font-family="monospace" font-size="30">${escapeXml(title)}</text>` +
    `<text x="40" y="128" fill="#7fd4ff" font-family="monospace" font-size="20">Room ${room.coordinates.x},${room.coordinates.y}</text>` +
    `<text x="40" y="164" fill="#aeb7c4" font-family="monospace" font-size="18">${escapeXml(goal)}</text>` +
    `<text x="40" y="200" fill="#aeb7c4" font-family="monospace" font-size="18">Background ${escapeXml(bg)}</text>` +
    `<text x="40" y="266" fill="#f5f1de" font-family="monospace" font-size="16">WAMP</text>` +
    `<text x="40" y="292" fill="#aeb7c4" font-family="monospace" font-size="14">On-chain room metadata with playable animation_url</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function buildRoomPreviewUrl(roomId: string): string {
  const url = new URL('/room-preview-render.html', ROOM_PREVIEW_RENDER_ORIGIN);
  url.searchParams.set('roomId', roomId);
  url.searchParams.set('apiBase', API_BASE);
  return url.toString();
}

function renderPublishedRoomImage(roomId: string): string {
  const previewUrl = buildRoomPreviewUrl(roomId);
  const inlineScript = `
import { chromium } from 'playwright';
import { renderRoomPreviewDataUrl } from ${JSON.stringify(renderHelperUrl)};

const dataUrl = await renderRoomPreviewDataUrl(chromium, ${JSON.stringify(previewUrl)});
process.stdout.write(JSON.stringify({ dataUrl }));
`;
  const output = execFileSync(
    'npx',
    ['--yes', '--quiet', '-p', 'playwright', 'node', '--input-type=module', '--eval', inlineScript],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_loglevel: 'silent',
      },
      maxBuffer: 10 * 1024 * 1024,
    }
  ).trim();
  const parsed = JSON.parse(output) as { dataUrl?: string };
  if (!parsed.dataUrl) {
    throw new Error(`Room preview renderer returned an empty image for ${roomId}.`);
  }
  return parsed.dataUrl;
}

async function main(): Promise<void> {
  const owner = await publicClient.readContract({
    address: CONTRACT,
    abi: ownerAbi,
    functionName: 'owner',
  });
  const logs = await publicClient.getContractEvents({
    address: CONTRACT,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    eventName: 'RoomMinted',
    fromBlock: 0n,
    toBlock: 'latest',
  });
  const feeData = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;

  const results: Array<Record<string, string | null>> = [];

  for (const log of logs) {
    const tokenId = log.args.tokenId?.toString() ?? '';
    if (onlyTokenIds.size > 0 && !onlyTokenIds.has(tokenId)) {
      continue;
    }
    const x = Number(log.args.x);
    const y = Number(log.args.y);
    const roomId = `${x},${y}`;
    try {
      const response = await fetch(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/published?x=${x}&y=${y}`
      );
      if (!response.ok) {
        throw new Error(`Failed to load published room ${roomId}: ${response.status}`);
      }

      const room = await response.json();
      let imageDataUrl: string;
      try {
        imageDataUrl = renderPublishedRoomImage(roomId);
      } catch (error) {
        if (!ALLOW_FALLBACK_IMAGE) {
          throw error;
        }
        imageDataUrl = buildFallbackSvg(room);
      }

      const built = await buildRoomTokenMetadata(room, imageDataUrl, {
        origin: ORIGIN,
        chainId: base.id,
        contractAddress: CONTRACT,
        tokenId,
      });
      const gas = await publicClient.estimateContractGas({
        account,
        address: CONTRACT,
        abi: ROOM_OWNERSHIP_TOKEN_ABI,
        functionName: 'setRoomTokenURI',
        args: [x, y, built.tokenUri],
      });

      let txHash: string | null = null;
      if (WRITE_ENABLED) {
        txHash = await walletClient.writeContract({
          address: CONTRACT,
          abi: ROOM_OWNERSHIP_TOKEN_ABI,
          functionName: 'setRoomTokenURI',
          args: [x, y, built.tokenUri],
          account,
          chain: base,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      }

      const tokenUri = await publicClient.readContract({
        address: CONTRACT,
        abi: ROOM_OWNERSHIP_TOKEN_ABI,
        functionName: 'tokenURI',
        args: [BigInt(tokenId)],
      });

      results.push({
        tokenId,
        roomId,
        title: room.title ?? null,
        payloadVersion: String(built.storedPayload.v),
        builtTokenUriLength: String(built.tokenUri.length),
        metadataJsonLength: String(built.metadataJson.length),
        imageDataUrlLength: String(imageDataUrl.length),
        estimatedGas: gas.toString(),
        estimatedCostEth: formatEther(gas * maxFeePerGas),
        onChainTokenUriLength: String(tokenUri.length),
        txHash,
        error: null,
      });
    } catch (error) {
      results.push({
        tokenId,
        roomId,
        title: null,
        payloadVersion: null,
        builtTokenUriLength: null,
        metadataJsonLength: null,
        imageDataUrlLength: null,
        estimatedGas: null,
        estimatedCostEth: null,
        onChainTokenUriLength: null,
        txHash: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        account: account.address,
        owner,
        writeEnabled: WRITE_ENABLED,
        maxFeePerGas: maxFeePerGas.toString(),
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
