import { decodeEventLog, decodeFunctionData, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { AuthUser } from '../../../auth/model';
import {
  buildRoomMintAuthorizationHash,
  ROOM_OWNERSHIP_TOKEN_ABI,
} from '../../../mint/roomOwnership';
import { sha256Hex } from '../../../mint/roomMetadata';
import { getRoomMintNetwork, parseRoomChainId } from '../../../mint/roomNetwork';
import { isRoomMinted, type RoomCoordinates, type RoomRecord } from '../../../persistence/roomModel';
import { normalizeAddress } from '../auth/store';
import { HttpError } from '../core/http';
import type { Env, RoomMintChainState, RoomMintConfig } from '../core/types';
import { createRoomMintPublicClient, createVerifiedRoomMintPublicClient } from './network';
export { createRoomMintPublicClient } from './network';

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
 * stay with the last synced token owner until the next successful read.
 */
export type RoomChainSyncFailureMode = 'throw' | 'use-stored';

// A tolerant sync gives up sooner: one retry and 5 s per call instead of viem's
// 3 retries and 10 s, so a hanging RPC delays a save by seconds rather than ~40 s.
const TOLERANT_CHAIN_READ_TRANSPORT = { retryCount: 1, timeout: 5_000 };

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
    config = getOptionalRoomMintConfig(env);
  } catch (error) {
    if (onChainError === 'throw') throw error;
    return record;
  }
  if (!config) {
    return record;
  }

  let chainState: RoomMintChainState | null;
  try {
    chainState = await readRoomMintStateFromChain(
      config,
      record.draft.coordinates,
      onChainError === 'use-stored' ? TOLERANT_CHAIN_READ_TRANSPORT : {}
    );
  } catch (error) {
    if (shouldSkipLocalRoomMintSync(config, error)) {
      console.warn('Skipping local room ownership sync because the local mint RPC is unavailable.', error);
      return record;
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
}

export async function readRoomMintStateFromChain(
  config: RoomMintConfig,
  coordinates: RoomCoordinates,
  transport: { retryCount?: number; timeout?: number } = {}
): Promise<RoomMintChainState | null> {
  const client = await createVerifiedRoomMintPublicClient(config, transport);
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

export async function verifyRoomTokenMetadataTransaction(
  config: RoomMintConfig,
  txHash: string,
  record: RoomRecord,
  expectedMetadataHash: string
): Promise<{
  tokenId: string;
  ownerWalletAddress: `0x${string}`;
  metadataHash: string;
  updatedAt: string;
}> {
  if (!record.mintedTokenId) {
    throw new HttpError(409, 'Room is not minted yet.');
  }

  const client = await createVerifiedRoomMintPublicClient(config);
  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  let transaction: Awaited<ReturnType<typeof client.getTransaction>>;

  try {
    receipt = await client.getTransactionReceipt({
      hash: txHash as Hex,
    });
    transaction = await client.getTransaction({
      hash: txHash as Hex,
    });
  } catch {
    throw new HttpError(
      409,
      'Metadata refresh transaction was not found yet. Wait for confirmation and try again.'
    );
  }

  if (receipt.status !== 'success') {
    throw new HttpError(400, 'Metadata refresh transaction failed.');
  }

  if (
    !receipt.to ||
    normalizeAddress(receipt.to) !== normalizeAddress(config.contractAddress) ||
    !transaction.to ||
    normalizeAddress(transaction.to) !== normalizeAddress(config.contractAddress)
  ) {
    throw new HttpError(400, 'Transaction was not sent to the configured room mint contract.');
  }

  const decoded = decodeFunctionData({
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    data: transaction.input,
  });

  if (decoded.functionName === 'setRoomTokenURI') {
    const [x, y] = decoded.args as readonly [number, number, string];
    if (Number(x) !== record.draft.coordinates.x || Number(y) !== record.draft.coordinates.y) {
      throw new HttpError(400, 'Transaction did not target the requested room.');
    }
  } else if (decoded.functionName === 'setTokenURI') {
    const [tokenId] = decoded.args as readonly [bigint, string];
    if (tokenId.toString() !== record.mintedTokenId) {
      throw new HttpError(400, 'Transaction did not target the requested room token.');
    }
  } else {
    throw new HttpError(400, 'Transaction did not update room token metadata.');
  }

  const tokenId = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    functionName: 'tokenIdForRoomCoordinates',
    args: [record.draft.coordinates.x, record.draft.coordinates.y],
  });

  if (tokenId === 0n) {
    throw new HttpError(409, 'Room token is not readable from the chain yet.');
  }

  const ownerWalletAddress = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  });

  const tokenUri = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    functionName: 'tokenURI',
    args: [tokenId],
  });

  const metadataHash = await sha256Hex(tokenUri);
  if (metadataHash !== expectedMetadataHash) {
    throw new HttpError(
      409,
      'On-chain token metadata does not match the room metadata that was submitted.'
    );
  }

  return {
    tokenId: tokenId.toString(),
    ownerWalletAddress,
    metadataHash,
    updatedAt: new Date().toISOString(),
  };
}

export async function persistRoomTokenMetadataState(
  env: Env,
  record: RoomRecord,
  state: {
    tokenId: string;
    ownerWalletAddress: string;
    metadataRoomVersion: number;
    metadataHash: string;
    updatedAt: string;
  },
  actor: AuthUser | null
): Promise<void> {
  const normalizedOwner = normalizeAddress(state.ownerWalletAddress);
  const actorOwnsMintedRoom =
    actor?.walletAddress != null &&
    normalizeAddress(actor.walletAddress) === normalizedOwner;
  const claimUserId = !record.claimerUserId && actor && actorOwnsMintedRoom ? actor.id : null;
  const claimDisplayName =
    !record.claimerDisplayName && actor && actorOwnsMintedRoom ? actor.displayName : null;
  const claimedAt = !record.claimedAt && actorOwnsMintedRoom ? state.updatedAt : null;

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
          minted_metadata_room_version = ?,
          minted_metadata_updated_at = ?,
          minted_metadata_hash = ?,
          claimer_user_id = COALESCE(claimer_user_id, ?),
          claimer_principal_type = COALESCE(claimer_principal_type, ?),
          claimer_agent_id = COALESCE(claimer_agent_id, NULL),
          claimer_display_name = COALESCE(claimer_display_name, ?),
          claimed_at = COALESCE(claimed_at, ?)
        WHERE id = ?
      `
    ).bind(
      record.mintedChainId,
      record.mintedContractAddress,
      state.tokenId,
      normalizedOwner,
      state.updatedAt,
      state.metadataRoomVersion,
      state.updatedAt,
      state.metadataHash,
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
