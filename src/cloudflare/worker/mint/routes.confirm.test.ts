// Room mint confirmation: who may record an on-chain mint against a room (F064).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../core/types';
import { HttpError } from '../core/http';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  loadForMutation: vi.fn(),
  loadRecord: vi.fn(),
  verifyMint: vi.fn(),
  persist: vi.fn(),
}));
vi.mock('../auth/request', () => ({ requireWalletLinkedRequestAuth: mocks.auth }));
vi.mock('../rooms/store', () => ({ loadRoomRecordForMutation: mocks.loadForMutation, loadRoomRecord: mocks.loadRecord }));
vi.mock('./service', async (importOriginal) => ({
  ...await importOriginal<typeof import('./service')>(),
  requireRoomMintConfig: () => ({ chainId: 8453 }),
  verifyMintTransactionForRoom: mocks.verifyMint,
  persistRoomMintState: mocks.persist,
}));

import { handleRoomMintConfirm } from './routes';

const coordinates = { x: 3, y: -2 };
const TX = `0x${'ab'.repeat(32)}`;
const WALLET = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const builder = { id: 'user-1', walletAddress: WALLET };

function confirm(txHash: string = TX) {
  const request = new Request('https://api.wamp.land/api/rooms/3,-2/mint/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land' }, body: JSON.stringify({ txHash }),
  });
  return handleRoomMintConfirm(request, {} as Env, '3,-2', coordinates);
}
function roomRecord(overrides: Record<string, unknown> = {}) {
  return { permissions: { canMint: true }, claimerUserId: 'user-1', mintedChainId: null, mintedContractAddress: null, mintedTokenId: null, ...overrides };
}
async function expectStatus(promise: Promise<unknown>, status: number, message: RegExp) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(status);
  expect((error as Error).message).toMatch(message);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: builder });
  mocks.loadForMutation.mockResolvedValue(roomRecord());
  mocks.verifyMint.mockResolvedValue({ ownerWalletAddress: WALLET, tokenId: '42' });
  mocks.persist.mockResolvedValue(undefined);
  mocks.loadRecord.mockResolvedValue({ id: '3,-2', mintedTokenId: '42' });
});

describe('room mint confirmation (F064)', () => {
  it('rejects a malformed transaction hash before touching the chain', async () => {
    await expectStatus(confirm('0x1234'), 400, /valid transaction hash/);
    expect(mocks.verifyMint).not.toHaveBeenCalled();
  });

  it('rejects a player who may not mint this unminted room', async () => {
    mocks.loadForMutation.mockResolvedValue(roomRecord({ permissions: { canMint: false } }));
    await expectStatus(confirm(), 403, /permission to mint/);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('rejects anyone but the current claimer', async () => {
    mocks.loadForMutation.mockResolvedValue(roomRecord({ claimerUserId: 'someone-else' }));
    await expectStatus(confirm(), 403, /Only the current claimer/);
    expect(mocks.verifyMint).not.toHaveBeenCalled();
  });

  it('rejects a mint whose token is owned by a different wallet', async () => {
    mocks.verifyMint.mockResolvedValue({ ownerWalletAddress: '0x2222222222222222222222222222222222222222', tokenId: '42' });
    await expectStatus(confirm(), 403, /linked wallet does not own/);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('records the mint for the owning wallet (address case does not matter) and returns the updated room', async () => {
    mocks.verifyMint.mockResolvedValue({ ownerWalletAddress: `0x${WALLET.slice(2).toUpperCase()}`, tokenId: '42' });
    const response = await confirm();
    expect(mocks.verifyMint).toHaveBeenCalledWith({ chainId: 8453 }, TX, coordinates);
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.persist.mock.calls[0][2]).toMatchObject({ tokenId: '42' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: '3,-2', mintedTokenId: '42' });
  });

  it('lets the claimer confirm a room that is already minted even without mint permission', async () => {
    mocks.loadForMutation.mockResolvedValue(roomRecord({ permissions: { canMint: false }, mintedTokenId: '42' }));
    const response = await confirm();
    expect(response.status).toBe(200);
    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });
});
