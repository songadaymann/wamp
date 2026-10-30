import { afterEach, describe, expect, it, vi } from 'vitest';
import { workerApi } from '../core/workerApi.testSupport';
import { ROOM_CRYPTO_FIELDS } from '../../../persistence/roomCryptoDetails';

const wallet = '0x2222222222222222222222222222222222222222';
const contract = '0x1111111111111111111111111111111111111111';
let api: ReturnType<typeof workerApi>;
afterEach(() => { api?.close(); vi.unstubAllGlobals(); });

describe('room ownership HTTP presentation', () => {
  it.each(['', '/summary', '/current'])('omits crypto from %s by default while preserving protection and owner permissions', async suffix => {
    api = workerApi();
    api.sqlite.prepare('UPDATE users SET wallet_address=? WHERE id=?').run(wallet, 'p1');
    api.sqlite.prepare(`UPDATE rooms SET minted_chain_id=8453,minted_contract_address=?,minted_token_id='42',
      minted_owner_wallet_address=?,minted_owner_synced_at=?,minted_metadata_room_version=1,
      minted_metadata_updated_at=?,minted_metadata_hash='artwork-hash' WHERE id='0,0'`)
      .run(contract, wallet, new Date().toISOString(), new Date().toISOString());
    const session = await api.signIn('p1');
    const path = `/api/rooms/0%2C0${suffix}`;
    for (const viewer of [null, session]) {
      const plain = await api.call(path, { session: viewer });
      const detailed = await api.call(`${path}?crypto=1`, { session: viewer });
      expect(plain.status).toBe(200); expect(detailed.status).toBe(200);
      const view = plain.body.summary ?? plain.body, crypto = detailed.body.summary ?? detailed.body;
      expect(view.isProtected).toBe(true);
      for (const key of ROOM_CRYPTO_FIELDS) expect(view).not.toHaveProperty(key);
      expect(crypto).toMatchObject({ isProtected: true, mintedTokenId: '42', mintedOwnerWalletAddress: wallet,
        mintedChainId: 8453, mintedContractAddress: contract, mintedMetadataHash: 'artwork-hash' });
      expect(view.permissions).toEqual(crypto.permissions);
      expect(view.permissions.canSaveDraft).toBe(viewer !== null);
      if (suffix === '/summary') expect(plain.headers.get('cache-control')).toBe(viewer ? 'private, no-store' : 'public, max-age=20');
    }
    // An email-only account never acquires rights from the public protection flag.
    const stranger = await api.call(path, { session: await api.signIn('p2') });
    expect((stranger.body.summary ?? stranger.body).permissions.canSaveDraft).toBe(false);
  });

  it('bypasses old full-detail entries and keeps anonymous opt-in and default caches separate', async () => {
    api = workerApi();
    api.sqlite.prepare("UPDATE rooms SET minted_token_id='42' WHERE id='0,0'").run();
    const stored = new Map<string, Response>();
    stored.set('https://api.wamp.land/api/rooms/0%2C0/summary', Response.json({ mintedTokenId: 'old cached token' }));
    vi.stubGlobal('caches', { default: {
      match: async (request: Request) => stored.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => { stored.set(request.url, response.clone()); },
    } });
    const diagnostics = [];
    for (const query of ['?crypto=1', '', '?crypto=1', '']) {
      const response = await api.call('/api/rooms/0%2C0/summary' + query);
      expect(response.status).toBe(200); expect(response.body.isProtected).toBe(true);
      expect(response.body.mintedTokenId).toBe(query ? '42' : undefined);
      diagnostics.push(response.headers.get('X-WAMP-Cache'));
    }
    expect(diagnostics).toEqual(['miss', 'miss', 'hit', 'hit']);
    expect(stored.size).toBe(3);
  });

  it('marks an uncollected room unprotected without exposing empty crypto fields', async () => {
    api = workerApi();
    const response = await api.call('/api/rooms/0%2C0/summary');
    expect(response.body.isProtected).toBe(false);
    for (const key of ROOM_CRYPTO_FIELDS) expect(response.body).not.toHaveProperty(key);
  });
});
