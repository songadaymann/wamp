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
  persistClaimer: vi.fn(),
}));
vi.mock('../auth/request', () => ({ requireWalletLinkedRequestAuth: mocks.auth }));
vi.mock('../rooms/store', () => ({ loadRoomRecordForMutation: mocks.loadForMutation, loadRoomRecord: mocks.loadRecord }));
vi.mock('./service', async (importOriginal) => ({
  ...await importOriginal<typeof import('./service')>(),
  requireRoomMintConfig: () => ({ chainId: 8453 }),
  verifyMintTransactionForRoom: mocks.verifyMint,
  persistRoomMintState: mocks.persist,
  persistMintedRoomClaimer: mocks.persistClaimer,
}));

import type { RoomRecord } from '../../../persistence/roomModel';
import { fixture } from '../activity/testDatabase';
import { handleRoomMintConfirm } from './routes';

const coordinates = { x: 3, y: -2 };
const TX = `0x${'ab'.repeat(32)}`;
const WALLET = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const CONTRACT = '0x1111111111111111111111111111111111111111';
const builder = { id: 'user-1', walletAddress: WALLET };

function confirm(txHash: string = TX, crypto = true) {
  const request = new Request('https://api.wamp.land/api/rooms/3,-2/mint/confirm' + (crypto ? '?crypto=1' : ''), {
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
  it('omits token details when confirmation does not opt into crypto', async () => {
    const response = await confirm(TX, false);
    expect(await response.json()).toEqual({ id: '3,-2', isProtected: true });
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
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

  it('keeps the current owner when the minter confirms after the token changed hands', async () => {
    const buyer = '0x3333333333333333333333333333333333333333';
    mocks.loadForMutation.mockResolvedValue(roomRecord({
      permissions: { canMint: false }, mintedChainId: 8453, mintedContractAddress: CONTRACT,
      mintedTokenId: '42', mintedOwnerWalletAddress: buyer,
    }));
    mocks.verifyMint.mockResolvedValue({ chainId: 8453, contractAddress: CONTRACT, ownerWalletAddress: WALLET, tokenId: '42' });
    mocks.loadRecord.mockResolvedValue({ id: '3,-2', mintedTokenId: '42', mintedOwnerWalletAddress: buyer });
    const response = await confirm();
    expect(response.status).toBe(200);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.persistClaimer).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ mintedOwnerWalletAddress: buyer });
  });

  it.each([[WALLET, true], ['0x3333333333333333333333333333333333333333', false]] as const)(
    'gives builder credit on a mint an earlier sync recorded without a claimer when the owner is %s: %s',
    async (owner, credited) => {
      const record = roomRecord({
        claimerUserId: null, permissions: { canMint: false }, mintedChainId: 8453, mintedContractAddress: CONTRACT,
        mintedTokenId: '42', mintedOwnerWalletAddress: owner,
      });
      mocks.loadForMutation.mockResolvedValue(record);
      mocks.verifyMint.mockResolvedValue({ chainId: 8453, contractAddress: CONTRACT, ownerWalletAddress: WALLET, tokenId: '42', ownerSyncedAt: '2026-10-22T00:00:00.000Z' });
      expect((await confirm()).status).toBe(200);
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.persistClaimer.mock.calls).toEqual(credited
        ? [[{}, record, expect.objectContaining({ id: 'user-1', walletAddress: WALLET }), '2026-10-22T00:00:00.000Z']] : []);
    },
  );
});

describe('persistMintedRoomClaimer', () => {
  it('sets the claimer only on an unclaimed room still recorded as owned by that wallet', async () => {
    const { persistMintedRoomClaimer } = await vi.importActual<typeof import('./service')>('./service');
    const f = fixture();
    try {
      const claimer = () => f.sqlite.prepare('SELECT claimer_user_id, claimer_principal_type, claimer_display_name, claimed_at FROM rooms WHERE id = ?').get('0,0');
      f.sqlite.prepare('UPDATE rooms SET claimer_user_id = NULL, minted_chain_id = 8453, minted_contract_address = ?, minted_token_id = ?, minted_owner_wallet_address = ? WHERE id = ?')
        .run(CONTRACT, '42', '0x3333333333333333333333333333333333333333', '0,0');
      const record = { draft: { id: '0,0' } } as RoomRecord, minter = { id: 'p1', displayName: 'p1', email: null, walletAddress: WALLET };
      await persistMintedRoomClaimer(f.env, record, minter, '2026-10-22T00:00:00.000Z');
      expect(claimer()).toMatchObject({ claimer_user_id: null });
      f.sqlite.prepare('UPDATE rooms SET minted_owner_wallet_address = ? WHERE id = ?').run(WALLET, '0,0');
      await persistMintedRoomClaimer(f.env, record, minter, '2026-10-22T00:00:00.000Z');
      expect(claimer()).toEqual({ claimer_user_id: 'p1', claimer_principal_type: 'user', claimer_display_name: 'p1', claimed_at: '2026-10-22T00:00:00.000Z' });
      await persistMintedRoomClaimer(f.env, record, { ...minter, id: 'p2' }, '2026-10-23T00:00:00.000Z');
      expect(claimer()).toMatchObject({ claimer_user_id: 'p1' });
    } finally { f.sqlite.close(); }
  });
});
