import { decodeEventLog, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { AuthUser } from '../../../auth/model';
import {
  buildRoomMintAuthorizationHash,
  ROOM_OWNERSHIP_TOKEN_ABI,
} from '../../../mint/roomOwnership';
import { getRoomMintNetwork, parseRoomChainId } from '../../../mint/roomNetwork';
import { isRoomMinted, type RoomCoordinates, type RoomRecord } from '../../../persistence/roomModel';
import { normalizeAddress } from '../auth/store';
import { HttpError } from '../core/http';
import type { Env, RoomMintChainState, RoomMintConfig } from '../core/types';
import { createRoomMintPublicClient, createVerifiedRoomMintPublicClient, type MintReadTransportOptions } from './network';
export { createRoomMintPublicClient } from './network';
import { observeRoomTokenMetadata, persistRoomTokenMetadataState, type RoomTokenMetadataObservation } from './metadata';
export { persistRoomTokenMetadataState, verifyRoomTokenMetadataTransaction } from './metadata';
type RoomMintObservedState = RoomMintChainState & { metadata?: RoomTokenMetadataObservation };

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

  const chainId = parseRoomChainId(env.ROOM_MINT_CHAIN_ID);
  if (chainId === null) {
    throw new HttpError(503, 'Room minting is unavailable because its network is not configured correctly.');
  }
  const network = getRoomMintNetwork(chainId);
  if (!network) throw new HttpError(503, 'Wallet network setup is unavailable for the configured mint chain.');

  return Object.freeze({
    chainId,
    chainName: env.ROOM_MINT_CHAIN_NAME?.trim() || network.name,
    rpcUrl,
    contractAddress,
    blockExplorerUrl:
      env.ROOM_MINT_BLOCK_EXPLORER_URL?.trim() || network.blockExplorerUrl,
  });
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

/**
 * What a chain-ownership sync does when the Base RPC fails. 'throw' fails the request
 * (minting and explicit ownership refreshes need the real chain state). 'use-stored'
 * keeps the ownership D1 last recorded, so an RPC outage or rate limit does not block
 * saves in every room: unminted rooms stay editable by their claimer, and minted rooms
 * stay with the last synced token owner until the next successful read. 'require-fresh'
 * also rejects disabled configuration and the local development fallback.
 */
export type RoomChainSyncFailureMode = 'throw' | 'use-stored' | 'require-fresh';

// A tolerant sync gives up sooner: one retry and 5 s per call instead of viem's
// 3 retries and 10 s, so a hanging RPC delays a save by seconds rather than ~40 s.
const TOLERANT_CHAIN_READ_TRANSPORT = { retryCount: 1, timeout: 5_000 };
// A manual refresh stays inside the caller's finite wait instead of retrying after it closes.
const FRESH_CHAIN_READ_TRANSPORT = { retryCount: 0, timeout: 5_000 };

export async function loadRoomMintPriceWei(config: RoomMintConfig): Promise<string> {
  const client = await createVerifiedRoomMintPublicClient(config);
  const priceWei = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    functionName: 'mintPriceWei',
  });

  return priceWei.toString();
}

export async function loadRoomMintAuthority(config: RoomMintConfig): Promise<`0x${string}`> {
  const client = await createVerifiedRoomMintPublicClient(config);
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
  actor: AuthUser | null,
  onChainError: RoomChainSyncFailureMode = 'throw'
): Promise<RoomRecord> {
  let config: RoomMintConfig | null;
  try {
    config = onChainError === 'require-fresh' ? requireRoomMintConfig(env) : getOptionalRoomMintConfig(env);
  } catch (error) {
    if (onChainError !== 'use-stored') throw error;
    return record;
  }
  if (!config) {
    return record;
  }

  let chainState: RoomMintObservedState | null;
  const abort = onChainError === 'require-fresh' ? new AbortController() : null;
  // The operation deadline also covers a provider stalling after response headers.
  const deadline = abort ? setTimeout(() => abort.abort(), 12_000) : null;
  try {
    chainState = await readRoomMintStateFromChain(
      config,
      record.draft.coordinates,
      onChainError === 'use-stored' ? TOLERANT_CHAIN_READ_TRANSPORT
        : abort ? { ...FRESH_CHAIN_READ_TRANSPORT, signal: abort.signal } : {},
      onChainError === 'require-fresh'
    );
  } catch (error) {
    if (onChainError !== 'require-fresh' && shouldSkipLocalRoomMintSync(config, error)) {
      console.warn('Skipping local room ownership sync because the local mint RPC is unavailable.', error);
      return record;
    }

    if (onChainError === 'require-fresh') {
      throw new HttpError(503, 'Could not check room ownership. Please try again.');
    }
    if (onChainError === 'throw') {
      throw error;
    }

    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(
      `Room ${record.draft.id} ownership sync skipped: Base RPC read failed; using stored ownership `
        + `(${isRoomMinted(record) ? `minted, owner ${record.mintedOwnerWalletAddress}` : 'unminted'}). ${reason}`
    );
    return record;
  } finally {
    if (deadline !== null) clearTimeout(deadline);
  }

  if (!chainState) {
    if (onChainError === 'require-fresh' && isRoomMinted(record)) {
      throw new HttpError(409, 'This room token could not be verified on the configured network.');
    }
    return record;
  }

  const ownershipChanged = roomMintStateNeedsUpdate(record, chainState);
  const metadataChanged = chainState.metadata && (record.mintedMetadataHash !== chainState.metadata.metadataHash
    || record.mintedMetadataRoomVersion !== chainState.metadata.metadataRoomVersion || !record.mintedMetadataUpdatedAt);
  if (!ownershipChanged && !metadataChanged) return record;
  if (ownershipChanged) await persistRoomMintState(env, record, chainState, actor);
  const updatedRecord: RoomRecord = {
    ...record,
    mintedChainId: chainState.chainId,
    mintedContractAddress: chainState.contractAddress,
    mintedTokenId: chainState.tokenId,
    mintedOwnerWalletAddress: normalizeAddress(chainState.ownerWalletAddress),
    mintedOwnerSyncedAt: chainState.ownerSyncedAt,
    mintedMetadataRoomVersion: record.mintedMetadataRoomVersion,
    mintedMetadataUpdatedAt: record.mintedMetadataUpdatedAt,
    mintedMetadataHash: record.mintedMetadataHash,
    claimerUserId:
      record.claimerUserId ??
      (actor?.walletAddress &&
      normalizeAddress(actor.walletAddress) === normalizeAddress(chainState.ownerWalletAddress)
        ? actor.id
        : null),
    claimerPrincipalKind:
      record.claimerPrincipalKind ??
      (actor?.walletAddress &&
      normalizeAddress(actor.walletAddress) === normalizeAddress(chainState.ownerWalletAddress)
        ? 'user'
        : null),
    claimerAgentId: record.claimerAgentId ?? null,
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
  if (metadataChanged && chainState.metadata) {
    await persistRoomTokenMetadataState(env, updatedRecord, { ...chainState, ...chainState.metadata, updatedAt: chainState.ownerSyncedAt });
    updatedRecord.mintedMetadataRoomVersion = chainState.metadata.metadataRoomVersion;
    updatedRecord.mintedMetadataHash = chainState.metadata.metadataHash;
    updatedRecord.mintedMetadataUpdatedAt = chainState.ownerSyncedAt;
  }
  return updatedRecord;
}

export async function readRoomMintStateFromChain(
  config: RoomMintConfig,
  coordinates: RoomCoordinates,
  transport: MintReadTransportOptions = {},
  includeMetadata = false,
): Promise<RoomMintObservedState | null> {
  const client = await createVerifiedRoomMintPublicClient(config, transport);
  const blockNumber = includeMetadata ? await client.getBlockNumber({ cacheTime: 0 }) : undefined;
  const tokenId = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    blockNumber,
    functionName: 'tokenIdForRoomCoordinates',
    args: [coordinates.x, coordinates.y],
  });

  if (tokenId === 0n) {
    return null;
  }

  const ownerWalletAddress = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    blockNumber,
    functionName: 'ownerOf',
    args: [tokenId],
  });

  const metadata = includeMetadata ? await observeRoomTokenMetadata(await client.readContract({
    address: config.contractAddress, abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'tokenURI', args: [tokenId], blockNumber,
  }), coordinates) : undefined;

  return {
    ...(metadata ? { metadata } : {}),
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
  const client = await createVerifiedRoomMintPublicClient(config);
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
          claimer_principal_type = COALESCE(claimer_principal_type, ?),
          claimer_agent_id = COALESCE(claimer_agent_id, NULL),
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
      claimUserId ? 'user' : null,
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
