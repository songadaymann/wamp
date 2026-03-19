import { encodeFunctionData } from 'viem';
import {
  ROOM_OWNERSHIP_TOKEN_ABI,
  type RoomMetadataRefreshConfirmRequestBody,
  type RoomMetadataRefreshPrepareRequestBody,
  type RoomMetadataRefreshPrepareResponse,
  type RoomMintConfirmRequestBody,
  type RoomMintPrepareResponse,
} from '../../../mint/roomOwnership';
import { isRoomMinted, type RoomCoordinates } from '../../../persistence/roomModel';
import { normalizeAddress } from '../auth/store';
import { requireWalletLinkedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { loadRoomRecord, loadRoomRecordForMutation } from '../rooms/store';
import {
  loadRoomMintPriceWei,
  persistRoomTokenMetadataState,
  persistRoomMintState,
  requireRoomMintConfig,
  signRoomMintAuthorization,
  verifyRoomTokenMetadataTransaction,
  verifyMintTransactionForRoom,
} from './service';

export async function handleRoomMintPrepare(
  request: Request,
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates
): Promise<Response> {
  const auth = await requireWalletLinkedRequestAuth(env, request, 'mint rooms', 'rooms:write');
  const config = requireRoomMintConfig(env);
  const record = await loadRoomRecordForMutation(env, roomId, coordinates, auth.user);

  if (!record.published) {
    throw new HttpError(400, 'Publish the room before minting it.');
  }

  if (record.claimerUserId && record.claimerUserId !== auth.user.id) {
    throw new HttpError(403, 'Only the current claimer can mint this room.');
  }

  if (!record.permissions.canMint) {
    if (isRoomMinted(record)) {
      throw new HttpError(409, 'This room has already been minted.');
    }

    throw new HttpError(403, 'You do not have permission to mint this room.');
  }

  const priceWei = await loadRoomMintPriceWei(config);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const linkedWalletAddress = auth.user.walletAddress as `0x${string}`;
  const signature = await signRoomMintAuthorization(
    env,
    config,
    record.draft.coordinates,
    linkedWalletAddress,
    deadline
  );

  const responseBody: RoomMintPrepareResponse = {
    roomId: record.draft.id,
    roomCoordinates: { ...record.draft.coordinates },
    linkedWalletAddress,
    contractAddress: config.contractAddress,
    priceWei,
    chain: {
      chainId: config.chainId,
      name: config.chainName,
      rpcUrl: config.rpcUrl,
      blockExplorerUrl: config.blockExplorerUrl,
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
    },
    transaction: {
      to: config.contractAddress,
      data: encodeFunctionData({
        abi: ROOM_OWNERSHIP_TOKEN_ABI,
        functionName: 'mintRoom',
        args: [
          record.draft.coordinates.x,
          record.draft.coordinates.y,
          linkedWalletAddress,
          deadline,
          signature,
        ],
      }),
      value: priceWei,
      chainId: config.chainId,
    },
  };

  return jsonResponse(request, responseBody);
}

export async function handleRoomMintConfirm(
  request: Request,
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates
): Promise<Response> {
  const auth = await requireWalletLinkedRequestAuth(
    env,
    request,
    'confirm room mints',
    'rooms:write'
  );
  const config = requireRoomMintConfig(env);
  const body = await parseRoomMintConfirmBody(request);
  const record = await loadRoomRecordForMutation(env, roomId, coordinates, auth.user);

  if (record.claimerUserId && record.claimerUserId !== auth.user.id) {
    throw new HttpError(403, 'Only the current claimer can confirm this room mint.');
  }

  const mintState = await verifyMintTransactionForRoom(config, body.txHash, coordinates);
  if (normalizeAddress(mintState.ownerWalletAddress) !== normalizeAddress(auth.user.walletAddress!)) {
    throw new HttpError(403, 'The linked wallet does not own the minted room token.');
  }

  await persistRoomMintState(env, record, mintState, auth.user);

  const updated = await loadRoomRecord(
    env,
    roomId,
    coordinates,
    auth.user.id,
    auth.user.walletAddress
  );

  return jsonResponse(request, updated);
}

export async function handleRoomTokenMetadataPrepare(
  request: Request,
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates
): Promise<Response> {
  const auth = await requireWalletLinkedRequestAuth(
    env,
    request,
    'refresh room NFT metadata',
    'rooms:write'
  );
  const config = requireRoomMintConfig(env);
  const body = await parseRoomMetadataRefreshPrepareBody(request);
  const record = await loadRoomRecordForMutation(env, roomId, coordinates, auth.user);

  if (!isRoomMinted(record) || !record.mintedTokenId || !record.mintedContractAddress) {
    throw new HttpError(409, 'This room is not minted yet.');
  }

  if (!record.published) {
    throw new HttpError(400, 'Publish the room before refreshing NFT metadata.');
  }

  if (!record.permissions.canSaveDraft) {
    throw new HttpError(403, 'Only the room token owner can refresh NFT metadata.');
  }

  const linkedWalletAddress = auth.user.walletAddress as `0x${string}`;
  if (
    !record.mintedOwnerWalletAddress ||
    normalizeAddress(record.mintedOwnerWalletAddress) !== normalizeAddress(linkedWalletAddress)
  ) {
    throw new HttpError(403, 'The linked wallet does not own the minted room token.');
  }

  const responseBody: RoomMetadataRefreshPrepareResponse = {
    roomId: record.draft.id,
    roomCoordinates: { ...record.draft.coordinates },
    linkedWalletAddress,
    contractAddress: record.mintedContractAddress,
    tokenId: record.mintedTokenId,
    chain: {
      chainId: config.chainId,
      name: config.chainName,
      rpcUrl: config.rpcUrl,
      blockExplorerUrl: config.blockExplorerUrl,
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
    },
    transaction: {
      to: record.mintedContractAddress,
      data: encodeFunctionData({
        abi: ROOM_OWNERSHIP_TOKEN_ABI,
        functionName: 'setRoomTokenURI',
        args: [record.draft.coordinates.x, record.draft.coordinates.y, body.tokenUri],
      }),
      value: '0',
      chainId: config.chainId,
    },
  };

  return jsonResponse(request, responseBody);
}

export async function handleRoomTokenMetadataConfirm(
  request: Request,
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates
): Promise<Response> {
  const auth = await requireWalletLinkedRequestAuth(
    env,
    request,
    'confirm room NFT metadata refresh',
    'rooms:write'
  );
  const config = requireRoomMintConfig(env);
  const body = await parseRoomMetadataRefreshConfirmBody(request);
  const record = await loadRoomRecordForMutation(env, roomId, coordinates, auth.user);

  if (!isRoomMinted(record) || !record.mintedTokenId) {
    throw new HttpError(409, 'This room is not minted yet.');
  }

  if (!record.permissions.canSaveDraft) {
    throw new HttpError(403, 'Only the room token owner can refresh NFT metadata.');
  }

  const metadataState = await verifyRoomTokenMetadataTransaction(
    config,
    body.txHash,
    record,
    body.metadataHash
  );
  if (
    normalizeAddress(metadataState.ownerWalletAddress) !== normalizeAddress(auth.user.walletAddress!)
  ) {
    throw new HttpError(403, 'The linked wallet does not own the minted room token.');
  }

  await persistRoomTokenMetadataState(
    env,
    record,
    {
      tokenId: metadataState.tokenId,
      ownerWalletAddress: metadataState.ownerWalletAddress,
      metadataRoomVersion: body.metadataRoomVersion,
      metadataHash: metadataState.metadataHash,
      updatedAt: metadataState.updatedAt,
    },
    auth.user
  );

  const updated = await loadRoomRecord(
    env,
    roomId,
    coordinates,
    auth.user.id,
    auth.user.walletAddress
  );

  return jsonResponse(request, updated);
}

export async function parseRoomMintConfirmBody(
  request: Request
): Promise<RoomMintConfirmRequestBody> {
  const body = await parseJsonBody<RoomMintConfirmRequestBody>(request);
  const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';

  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new HttpError(400, 'txHash must be a valid transaction hash.');
  }

  return { txHash };
}

async function parseRoomMetadataRefreshPrepareBody(
  request: Request
): Promise<RoomMetadataRefreshPrepareRequestBody> {
  const body = await parseJsonBody<RoomMetadataRefreshPrepareRequestBody>(request);
  const tokenUri = typeof body.tokenUri === 'string' ? body.tokenUri.trim() : '';

  if (!tokenUri.startsWith('data:application/json;base64,')) {
    throw new HttpError(400, 'tokenUri must be a data:application/json;base64 URI.');
  }

  if (tokenUri.length > 100_000) {
    throw new HttpError(400, 'tokenUri is too large to submit.');
  }

  return { tokenUri };
}

async function parseRoomMetadataRefreshConfirmBody(
  request: Request
): Promise<RoomMetadataRefreshConfirmRequestBody> {
  const body = await parseJsonBody<RoomMetadataRefreshConfirmRequestBody>(request);
  const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
  const metadataHash = typeof body.metadataHash === 'string' ? body.metadataHash.trim().toLowerCase() : '';

  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    throw new HttpError(400, 'txHash must be a valid transaction hash.');
  }

  if (!/^[a-f0-9]{64}$/.test(metadataHash)) {
    throw new HttpError(400, 'metadataHash must be a 64-character lowercase hex digest.');
  }

  if (!Number.isInteger(body.metadataRoomVersion) || body.metadataRoomVersion < 1) {
    throw new HttpError(400, 'metadataRoomVersion must be a positive integer.');
  }

  return {
    txHash,
    metadataRoomVersion: body.metadataRoomVersion,
    metadataHash,
  };
}
