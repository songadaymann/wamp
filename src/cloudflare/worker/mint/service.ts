import { createPublicClient, decodeEventLog, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { AuthUser } from '../../../auth/model';
import {
  buildRoomMintAuthorizationHash,
  DEFAULT_ROOM_MINT_BLOCK_EXPLORER_URL,
  DEFAULT_ROOM_MINT_CHAIN_ID,
  DEFAULT_ROOM_MINT_CHAIN_NAME,
  ROOM_OWNERSHIP_TOKEN_ABI,
} from '../../../mint/roomOwnership';
import { type RoomCoordinates, type RoomRecord } from '../../../persistence/roomModel';
import { normalizeAddress } from '../auth/store';
import { HttpError } from '../core/http';
import type { Env, RoomMintChainState, RoomMintConfig } from '../core/types';

export function getOptionalRoomMintConfig(env: Env): RoomMintConfig | null {
  if (env.ROOM_MINT_DISABLED?.trim() === '1') {
    return null;
  }

  const contractAddress = env.ROOM_MINT_CONTRACT_ADDRESS?.trim() ?? '';
  const rpcUrl = env.ROOM_MINT_RPC_URL?.trim() ?? '';

  if (!contractAddress && !rpcUrl) {
    return null;
  }

  if (!contractAddress || !rpcUrl) {
    throw new HttpError(
      500,
      'Room minting is partially configured. Set both ROOM_MINT_CONTRACT_ADDRESS and ROOM_MINT_RPC_URL.'
    );
  }

  if (!isAddress(contractAddress)) {
    throw new HttpError(500, 'ROOM_MINT_CONTRACT_ADDRESS must be a valid EVM address.');
  }

  const rawChainId = env.ROOM_MINT_CHAIN_ID?.trim();
  const chainId = rawChainId ? Number(rawChainId) : DEFAULT_ROOM_MINT_CHAIN_ID;
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new HttpError(500, 'ROOM_MINT_CHAIN_ID must be a positive integer.');
  }

  return {
    chainId,
    chainName: env.ROOM_MINT_CHAIN_NAME?.trim() || DEFAULT_ROOM_MINT_CHAIN_NAME,
    rpcUrl,
    contractAddress,
    blockExplorerUrl:
      env.ROOM_MINT_BLOCK_EXPLORER_URL?.trim() || DEFAULT_ROOM_MINT_BLOCK_EXPLORER_URL,
  };
}

export function requireRoomMintConfig(env: Env): RoomMintConfig {
  const config = getOptionalRoomMintConfig(env);
  if (!config) {
    throw new HttpError(503, 'Room minting is not configured on this backend.');
  }

  return config;
}

export function requireRoomMintAuthAccount(env: Env) {
  const privateKey = normalizeRoomMintPrivateKey(env.ROOM_MINT_AUTH_PRIVATE_KEY);
  if (!privateKey) {
    throw new HttpError(
      503,
      'Room mint authorization signing is not configured on this backend.'
    );
  }

  return privateKeyToAccount(privateKey);
}

export function createRoomMintPublicClient(config: RoomMintConfig) {
  return createPublicClient({
    transport: http(config.rpcUrl),
  });
}

export async function loadRoomMintPriceWei(config: RoomMintConfig): Promise<string> {
  const client = createRoomMintPublicClient(config);
  const priceWei = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    functionName: 'mintPriceWei',
  });

  return priceWei.toString();
}

export async function loadRoomMintAuthority(config: RoomMintConfig): Promise<`0x${string}`> {
  const client = createRoomMintPublicClient(config);
  return client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    functionName: 'mintAuthority',
  });
}

export async function signRoomMintAuthorization(
  env: Env,
  config: RoomMintConfig,
  coordinates: RoomCoordinates,
  claimer: `0x${string}`,
  deadline: bigint
): Promise<Hex> {
  const account = requireRoomMintAuthAccount(env);
  const onChainMintAuthority = normalizeAddress(await loadRoomMintAuthority(config));
  if (normalizeAddress(account.address) !== onChainMintAuthority) {
    throw new HttpError(
      500,
      'ROOM_MINT_AUTH_PRIVATE_KEY does not match the configured contract mint authority.'
    );
  }

  const authorizationHash = buildRoomMintAuthorizationHash(
    config.chainId,
    config.contractAddress,
    coordinates,
    claimer,
    deadline
  );

  return account.signMessage({
    message: { raw: authorizationHash },
  });
}

export async function syncRoomOwnershipFromChain(
  env: Env,
  record: RoomRecord,
  actor: AuthUser | null
): Promise<RoomRecord> {
  const config = getOptionalRoomMintConfig(env);
  if (!config) {
    return record;
  }

  let chainState: RoomMintChainState | null;
  try {
    chainState = await readRoomMintStateFromChain(config, record.draft.coordinates);
  } catch (error) {
    if (!shouldSkipLocalRoomMintSync(config, error)) {
      throw error;
    }

    console.warn('Skipping local room ownership sync because the local mint RPC is unavailable.', error);
    return record;
  }

  if (!chainState) {
    return record;
  }

  if (!roomMintStateNeedsUpdate(record, chainState)) {
    return record;
  }

  await persistRoomMintState(env, record, chainState, actor);
  return {
    ...record,
    mintedChainId: chainState.chainId,
    mintedContractAddress: chainState.contractAddress,
    mintedTokenId: chainState.tokenId,
    mintedOwnerWalletAddress: normalizeAddress(chainState.ownerWalletAddress),
    mintedOwnerSyncedAt: chainState.ownerSyncedAt,
    claimerUserId:
      record.claimerUserId ??
      (actor?.walletAddress &&
      normalizeAddress(actor.walletAddress) === normalizeAddress(chainState.ownerWalletAddress)
        ? actor.id
        : null),
    claimerDisplayName:
      record.claimerDisplayName ??
      (actor?.walletAddress &&
      normalizeAddress(actor.walletAddress) === normalizeAddress(chainState.ownerWalletAddress)
        ? actor.displayName
        : null),
    claimedAt:
      record.claimedAt ??
      (actor?.walletAddress &&
      normalizeAddress(actor.walletAddress) === normalizeAddress(chainState.ownerWalletAddress)
        ? chainState.ownerSyncedAt
        : null),
  };
}

export async function readRoomMintStateFromChain(
  config: RoomMintConfig,
  coordinates: RoomCoordinates
): Promise<RoomMintChainState | null> {
  const client = createRoomMintPublicClient(config);
  const tokenId = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    functionName: 'tokenIdForRoomCoordinates',
    args: [coordinates.x, coordinates.y],
  });

  if (tokenId === 0n) {
    return null;
  }

  const ownerWalletAddress = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });

  return {
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    tokenId: tokenId.toString(),
    ownerWalletAddress,
    ownerSyncedAt: new Date().toISOString(),
  };
}

export function shouldSkipLocalRoomMintSync(config: RoomMintConfig, _error: unknown): boolean {
  try {
    const hostname = new URL(config.rpcUrl).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return false;
  }
}

export async function verifyMintTransactionForRoom(
  config: RoomMintConfig,
  txHash: string,
  coordinates: RoomCoordinates
): Promise<RoomMintChainState> {
  const client = createRoomMintPublicClient(config);
  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;

  try {
    receipt = await client.getTransactionReceipt({
      hash: txHash as Hex,
    });
  } catch {
    throw new HttpError(409, 'Mint transaction was not found yet. Wait for confirmation and try again.');
  }

  if (receipt.status !== 'success') {
    throw new HttpError(400, 'Mint transaction failed.');
  }

  if (!receipt.to || normalizeAddress(receipt.to) !== normalizeAddress(config.contractAddress)) {
    throw new HttpError(400, 'Transaction was not sent to the configured room mint contract.');
  }

  let tokenId: bigint | null = null;
  for (const log of receipt.logs) {
    if (normalizeAddress(log.address) !== normalizeAddress(config.contractAddress)) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ROOM_OWNERSHIP_TOKEN_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'RoomMinted') {
        continue;
      }

      const args = decoded.args as {
        tokenId: bigint;
        x: number | bigint;
        y: number | bigint;
      };

      if (Number(args.x) === coordinates.x && Number(args.y) === coordinates.y) {
        tokenId = args.tokenId;
        break;
      }
    } catch {
      continue;
    }
  }

  if (tokenId === null) {
    throw new HttpError(400, 'Transaction did not mint the requested room.');
  }

  const ownerWalletAddress = await waitForMintedRoomOwner(
    client,
    config,
    coordinates,
    tokenId,
    receipt.blockNumber
  );

  return {
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    tokenId: tokenId.toString(),
    ownerWalletAddress,
    ownerSyncedAt: new Date().toISOString(),
  };
}

export function roomMintStateNeedsUpdate(record: RoomRecord, state: RoomMintChainState): boolean {
  return (
    record.mintedChainId !== state.chainId ||
    normalizeNullableAddress(record.mintedContractAddress) !==
      normalizeNullableAddress(state.contractAddress) ||
    record.mintedTokenId !== state.tokenId ||
    normalizeNullableAddress(record.mintedOwnerWalletAddress) !==
      normalizeNullableAddress(state.ownerWalletAddress) ||
    record.mintedOwnerSyncedAt === null
  );
}

async function waitForMintedRoomOwner(
  client: ReturnType<typeof createRoomMintPublicClient>,
  config: RoomMintConfig,
  coordinates: RoomCoordinates,
  tokenId: bigint,
  blockNumber: bigint
): Promise<`0x${string}`> {
  const maxAttempts = 6;
  const retryDelayMs = 750;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const tokenIdForRoom = await client.readContract({
        address: config.contractAddress,
        abi: ROOM_OWNERSHIP_TOKEN_ABI,
        functionName: 'tokenIdForRoomCoordinates',
        args: [coordinates.x, coordinates.y],
        blockNumber,
      });

      if (tokenIdForRoom === tokenId) {
        return client.readContract({
          address: config.contractAddress,
          abi: ROOM_OWNERSHIP_TOKEN_ABI,
          functionName: 'ownerOf',
          args: [tokenId],
          blockNumber,
        });
      }

      if (tokenIdForRoom !== 0n) {
        throw new HttpError(400, 'Mint transaction resolved to an unexpected room token.');
      }
    } catch (error) {
      if (error instanceof HttpError && error.status !== 409) {
        throw error;
      }
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  console.warn('Mint receipt was confirmed, but the minted owner was not readable yet.', {
    contractAddress: config.contractAddress,
    coordinates,
    tokenId: tokenId.toString(),
    blockNumber: blockNumber.toString(),
    lastError,
  });
  throw new HttpError(
    409,
    'Mint transaction confirmed, but the contract state is not readable from the RPC yet. Wait a few seconds and try again.'
  );
}

export async function persistRoomMintState(
  env: Env,
  record: RoomRecord,
  state: RoomMintChainState,
  actor: AuthUser | null
): Promise<void> {
  const actorOwnsMintedRoom =
    actor?.walletAddress != null &&
    normalizeAddress(actor.walletAddress) === normalizeAddress(state.ownerWalletAddress);
  const claimUserId = !record.claimerUserId && actor && actorOwnsMintedRoom ? actor.id : null;
  const claimDisplayName =
    !record.claimerDisplayName && actor && actorOwnsMintedRoom ? actor.displayName : null;
  const claimedAt = !record.claimedAt && actorOwnsMintedRoom ? state.ownerSyncedAt : null;

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE rooms
        SET
          minted_chain_id = ?,
          minted_contract_address = ?,
          minted_token_id = ?,
          minted_owner_wallet_address = ?,
          minted_owner_synced_at = ?,
          claimer_user_id = COALESCE(claimer_user_id, ?),
          claimer_display_name = COALESCE(claimer_display_name, ?),
          claimed_at = COALESCE(claimed_at, ?)
        WHERE id = ?
      `
    ).bind(
      state.chainId,
      state.contractAddress,
      state.tokenId,
      normalizeAddress(state.ownerWalletAddress),
      state.ownerSyncedAt,
      claimUserId,
      claimDisplayName,
      claimedAt,
      record.draft.id
    ),
  ]);
}

export function normalizeNullableAddress(address: string | null): string | null {
  return address ? normalizeAddress(address) : null;
}

function normalizeRoomMintPrivateKey(value: string | null | undefined): `0x${string}` | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
}
