import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createPublicClientMock } = vi.hoisted(() => ({
  createPublicClientMock: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
  };
});

import { createDefaultRoomRecord } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { syncRoomOwnershipFromChain } from './service';

const CONTRACT_ADDRESS = '0x1111111111111111111111111111111111111111';
const OWNER_ADDRESS = '0x2222222222222222222222222222222222222222';

function createEnv(rpcUrl = 'https://rpc.example.test') {
  const statement = {
    bind: vi.fn().mockReturnThis(),
  };
  const db = {
    prepare: vi.fn(() => statement),
    batch: vi.fn(async () => []),
  };

  return {
    env: {
      DB: db,
      ROOM_MINT_RPC_URL: rpcUrl,
      ROOM_MINT_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
      ROOM_MINT_CHAIN_ID: '8453',
    } as unknown as Env,
    db,
  };
}

function createMintedRecord() {
  return {
    ...createDefaultRoomRecord('0,0', { x: 0, y: 0 }),
    mintedChainId: 8453,
    mintedContractAddress: CONTRACT_ADDRESS,
    mintedTokenId: '7',
  };
}

describe('room ownership synchronization during mutations', () => {
  beforeEach(() => {
    createPublicClientMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows an unminted room mutation when the configured RPC read fails', async () => {
    const readContract = vi.fn().mockRejectedValue(new Error('RPC unavailable'));
    createPublicClientMock.mockReturnValue({ readContract });
    const { env, db } = createEnv();
    const record = createDefaultRoomRecord('0,0', { x: 0, y: 0 });

    await expect(syncRoomOwnershipFromChain(env, record, null, {
      allowStaleUnmintedRoomOnReadFailure: true,
    })).resolves.toBe(record);
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('fails closed for a minted room mutation when ownership cannot be verified', async () => {
    const readContract = vi.fn().mockRejectedValue(new Error('RPC unavailable'));
    createPublicClientMock.mockReturnValue({ readContract });
    const { env, db } = createEnv();

    await expect(syncRoomOwnershipFromChain(env, createMintedRecord(), null, {
      allowStaleUnmintedRoomOnReadFailure: true,
    })).rejects.toMatchObject({
      status: 503,
      message: 'Room ownership check is temporarily unavailable. Try again shortly.',
    });
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('persists a successful ownership synchronization', async () => {
    const readContract = vi.fn()
      .mockResolvedValueOnce(42n)
      .mockResolvedValueOnce(OWNER_ADDRESS);
    createPublicClientMock.mockReturnValue({ readContract });
    const { env, db } = createEnv();
    const record = createDefaultRoomRecord('0,0', { x: 0, y: 0 });

    const updated = await syncRoomOwnershipFromChain(env, record, null, {
      allowStaleUnmintedRoomOnReadFailure: true,
    });

    expect(updated).toMatchObject({
      mintedChainId: 8453,
      mintedContractAddress: CONTRACT_ADDRESS,
      mintedTokenId: '42',
      mintedOwnerWalletAddress: OWNER_ADDRESS,
    });
    expect(updated.mintedOwnerSyncedAt).toEqual(expect.any(String));
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it('retains the existing local-development bypass when a local RPC is offline', async () => {
    const readContract = vi.fn().mockRejectedValue(new Error('local node offline'));
    createPublicClientMock.mockReturnValue({ readContract });
    const { env, db } = createEnv('http://127.0.0.1:8545');
    const record = createMintedRecord();

    await expect(syncRoomOwnershipFromChain(env, record, null, {
      allowStaleUnmintedRoomOnReadFailure: true,
    })).resolves.toBe(record);
    expect(db.batch).not.toHaveBeenCalled();
  });
});
