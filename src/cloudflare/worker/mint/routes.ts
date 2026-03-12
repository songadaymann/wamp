import { encodeFunctionData } from 'viem';
import { ROOM_OWNERSHIP_TOKEN_ABI, type RoomMintConfirmRequestBody, type RoomMintPrepareResponse } from '../../../mint/roomOwnership';
import { isRoomMinted, type RoomCoordinates } from '../../../persistence/roomModel';
import { normalizeAddress } from '../auth/store';
import { requireWalletLinkedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { loadRoomRecord, loadRoomRecordForMutation } from '../rooms/store';
import {
  loadRoomMintPriceWei,
  persistRoomMintState,
  requireRoomMintConfig,
  signRoomMintAuthorization,
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
