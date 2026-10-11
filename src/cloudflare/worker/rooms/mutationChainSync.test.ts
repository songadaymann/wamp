import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, fixture } from '../activity/testDatabase';
import { findUserById } from '../auth/store';
import { loadRoomRecordForMutation } from './store';

const OWNER = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0x2222222222222222222222222222222222222222';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Room 0,0 with minting configured, a Base RPC stub, and a count of full history loads. */
function mintFixture(rpc: 'down' | 'unminted') {
  const f = fixture();
  Object.assign(f.env, { ROOM_MINT_CONTRACT_ADDRESS: CONTRACT, ROOM_MINT_RPC_URL: 'https://base-rpc.example' });
  const rpcCalls = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (rpc === 'down') return new Response('over rate limit', { status: 429 });
    const { id } = JSON.parse(String(init?.body)) as { id: number };
    return Response.json({ jsonrpc: '2.0', id, result: `0x${'0'.repeat(64)}` });
  });
  vi.stubGlobal('fetch', rpcCalls);
  let historyLoads = 0;
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => {
    if (/FROM room_versions/.test(sql) && /snapshot_json/.test(sql)) historyLoads += 1;
    return prepare(sql);
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { ...f, rpcCalls, historyLoads: () => historyLoads };
}

const load = async (f: ReturnType<typeof mintFixture>, userId: string, mode?: 'throw' | 'use-stored') =>
  loadRoomRecordForMutation(f.env, '0,0', { x: 0, y: 0 }, await findUserById(f.env, userId), false, mode);

describe('room writes during a Base RPC outage (F236)', () => {
  it('keeps saving an unminted room from stored ownership, with one quick retry', async () => {
    const f = mintFixture('down');
    const record = await load(f, 'builder');
    expect(record.permissions.canSaveDraft).toBe(true);
    expect(f.rpcCalls).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toMatch(/Room 0,0 ownership sync skipped.*unminted/);
  });

  it('keeps a minted room with its last synced token owner', async () => {
    const f = mintFixture('down');
    f.sqlite.prepare(`UPDATE users SET wallet_address = ? WHERE id = 'builder'`).run(OWNER);
    f.sqlite.prepare(`UPDATE rooms SET minted_chain_id = 8453, minted_contract_address = ?, minted_token_id = '7',
      minted_owner_wallet_address = ?, minted_owner_synced_at = ? WHERE id = '0,0'`).run(CONTRACT, OWNER, NOW);
    expect((await load(f, 'builder')).permissions.canSaveDraft).toBe(true);
    expect((await load(f, 'p1')).permissions.canSaveDraft).toBe(false);
  });

  it('still fails minting and ownership refreshes when the chain cannot be read', async () => {
    const f = mintFixture('down');
    await expect(load(f, 'builder', 'throw')).rejects.toThrow();
  });

  it('loads the room history once when the chain read changes nothing', async () => {
    const f = mintFixture('unminted');
    await load(f, 'builder');
    expect(f.rpcCalls).toHaveBeenCalledTimes(1);
    expect(f.historyLoads()).toBe(1);
  });
});
