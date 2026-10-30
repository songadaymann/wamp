import { decodeFunctionData, type Hex } from 'viem';
import { ROOM_OWNERSHIP_TOKEN_ABI } from '../../../mint/roomOwnership';
import { observeRoomTokenMetadata, type RoomTokenMetadataObservation } from '../../../mint/roomMetadataObservation';
export { observeRoomTokenMetadata, type RoomTokenMetadataObservation } from '../../../mint/roomMetadataObservation';
import type { RoomRecord } from '../../../persistence/roomModel';
import { normalizeAddress } from '../auth/store';
import { HttpError } from '../core/http';
import type { Env, RoomMintConfig } from '../core/types';
import { createVerifiedRoomMintPublicClient } from './network';

export function assertRoomTokenMetadataIdentity(config: RoomMintConfig, record: RoomRecord): void {
  if (record.mintedChainId !== config.chainId || !record.mintedContractAddress
    || normalizeAddress(record.mintedContractAddress) !== normalizeAddress(config.contractAddress)
    || !record.mintedTokenId) {
    throw new HttpError(409, 'The room token does not match the configured network. Check ownership and try again.');
  }
}

export async function verifyRoomTokenMetadataTransaction(
  config: RoomMintConfig,
  txHash: string,
  record: RoomRecord,
  expectedMetadataHash: string
): Promise<{
  chainId: number;
  contractAddress: string;
  tokenId: string;
  ownerWalletAddress: `0x${string}`;
  metadataRoomVersion: number;
  metadataHash: string;
  updatedAt: string;
}> {
  assertRoomTokenMetadataIdentity(config, record);

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

  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const tokenId = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    blockNumber,
    functionName: 'tokenIdForRoomCoordinates',
    args: [record.draft.coordinates.x, record.draft.coordinates.y],
  });

  if (tokenId === 0n) {
    throw new HttpError(409, 'Room token is not readable from the chain yet.');
  }

  if (tokenId.toString() !== record.mintedTokenId) {
    throw new HttpError(409, 'The room token identity changed. Check ownership and try again.');
  }

  const ownerWalletAddress = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    blockNumber,
    functionName: 'ownerOf',
    args: [tokenId],
  });

  const tokenUri = await client.readContract({
    address: config.contractAddress,
    abi: ROOM_OWNERSHIP_TOKEN_ABI,
    blockNumber,
    functionName: 'tokenURI',
    args: [tokenId],
  });

  const observation = await observeRoomTokenMetadata(tokenUri, record.draft.coordinates);
  const metadataHash = observation.metadataHash;
  if (metadataHash !== expectedMetadataHash) {
    throw new HttpError(
      409,
      'On-chain token metadata does not match the room metadata that was submitted.'
    );
  }

  if (observation.metadataRoomVersion === null) {
    throw new HttpError(400, 'On-chain artwork does not contain a valid version of this room.');
  }

  return {
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    tokenId: tokenId.toString(),
    metadataRoomVersion: observation.metadataRoomVersion,
    ownerWalletAddress,
    metadataHash,
    updatedAt: new Date().toISOString(),
  };
}

/** Only artwork cache fields are written; ownership and builder identity have separate owners. */
export async function persistRoomTokenMetadataState(
  env: Env,
  record: RoomRecord,
  state: RoomTokenMetadataObservation & { chainId: number; contractAddress: string; tokenId: string; updatedAt: string },
): Promise<void> {
  if (record.mintedChainId !== state.chainId || !record.mintedContractAddress
    || normalizeAddress(record.mintedContractAddress) !== normalizeAddress(state.contractAddress)
    || record.mintedTokenId !== state.tokenId) {
    throw new HttpError(409, 'The room token identity changed. Check ownership and try again.');
  }
  const result = await env.DB.prepare(`
    UPDATE rooms SET minted_metadata_room_version = ?, minted_metadata_hash = ?, minted_metadata_updated_at = ?
    WHERE id = ? AND minted_chain_id = ? AND LOWER(minted_contract_address) = ? AND minted_token_id = ?
      AND minted_metadata_hash IS ? AND minted_metadata_room_version IS ? AND minted_metadata_updated_at IS ?
    RETURNING id
  `).bind(state.metadataRoomVersion, state.metadataHash, state.updatedAt, record.draft.id,
    state.chainId, normalizeAddress(state.contractAddress), state.tokenId,
    record.mintedMetadataHash, record.mintedMetadataRoomVersion, record.mintedMetadataUpdatedAt).all<{ id: string }>();
  if (result.results.length !== 1) {
    throw new HttpError(409, 'The room artwork record changed. Check it again before retrying.');
  }
}
