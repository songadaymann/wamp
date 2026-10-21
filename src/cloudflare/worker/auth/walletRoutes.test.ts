import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { fixture } from '../activity/testDatabase';
import { handleAuthRequest } from './routes';
import { createApiTokenForUser, createSession, createUserForWallet, findUserById, generateOpaqueToken, hashToken, API_TOKEN_PREFIX } from './store';
import { createSchoolClassroom, createSchoolStudent } from '../school/store';

const databases: ReturnType<typeof fixture>[] = [];
function database() { const f = fixture(); databases.push(f); return f; }
afterEach(() => { vi.restoreAllMocks(); for (const f of databases.splice(0)) f.sqlite.close(); });
const account = () => privateKeyToAccount(generatePrivateKey());
function request(path: string, body: unknown, cookie?: string, origin: string | null = 'https://wamp.land', authorization?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin !== null) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', `ep_session=${cookie}`);
  if (authorization) headers.set('Authorization', authorization);
  return new Request(`https://api.wamp.land/api/auth/wallet/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
const dispatch = (f: ReturnType<typeof fixture>, r: Request) => handleAuthRequest(r, new URL(r.url), f.env);
async function proof(f: ReturnType<typeof fixture>, wallet = account(), cookie?: string) {
  const response = await dispatch(f, request('challenge', { address: wallet.address }, cookie));
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const challenge = await response.json() as { address: string; message: string; expiresAt: string };
  return { wallet, challenge, body: { address: wallet.address, message: challenge.message, signature: await wallet.signMessage({ message: challenge.message }) } };
}

describe('wallet authentication intent and linking', () => {
  it('signs in with a real ephemeral EOA proof and creates one session; replay cannot create another', async () => {
    const f = database(), p = await proof(f);
    expect(p.challenge.message).toContain('sign in with your wallet');
    const response = await dispatch(f, request('verify', p.body));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Set-Cookie')).toMatch(/ep_session=.+HttpOnly.*Secure/);
    const result = await response.json() as { user: { walletAddress: string }; linkedWallet: boolean };
    expect(result.user.walletAddress).toBe(p.wallet.address.toLowerCase()); expect(result.linkedWallet).toBe(false);
    await expect(dispatch(f, request('verify', p.body))).rejects.toMatchObject({ status: 401 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 1 });
  });
  it('links to the named session account while preserving its rooms and profile', async () => {
    const f = database(), token = await createSession(f.env, 'builder'), p = await proof(f, account(), token);
    expect(p.challenge.message).toContain('Link this wallet'); expect(p.challenge.message).toContain('builder (builder)');
    const before = await findUserById(f.env, 'builder');
    const response = await dispatch(f, request('verify', p.body, token));
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await response.json()).toMatchObject({ linkedWallet: true, user: { ...before, walletAddress: p.wallet.address.toLowerCase() } });
    expect(f.sqlite.prepare("SELECT claimer_user_id FROM rooms WHERE id='0,0'").get()).toMatchObject({ claimer_user_id: 'builder' });
  });
  it.each(['another-user', 'another-session', 'signed-out'])('cannot use link proof after %s', async mode => {
    const f = database(), token = await createSession(f.env, 'builder'), p = await proof(f, account(), token);
    const other = mode === 'signed-out' ? undefined : await createSession(f.env, mode === 'another-user' ? 'p1' : 'builder');
    await expect(dispatch(f, request('verify', p.body, other))).rejects.toMatchObject({ status: 409 });
    expect((await findUserById(f.env, 'builder'))?.walletAddress).toBeNull();
    expect((await dispatch(f, request('verify', p.body, token))).status).toBe(200);
  });
  it('cannot turn a signed-out proof into a link after signing in', async () => {
    const f = database(), p = await proof(f), token = await createSession(f.env, 'builder');
    await expect(dispatch(f, request('verify', p.body, token))).rejects.toMatchObject({ status: 409 });
    expect((await findUserById(f.env, 'builder'))?.walletAddress).toBeNull();
    expect((await dispatch(f, request('verify', p.body))).status).toBe(200);
  });
  it('consumes a proof once under concurrent verification', async () => {
    const f = database(), p = await proof(f);
    const results = await Promise.allSettled([dispatch(f, request('verify', p.body)), dispatch(f, request('verify', p.body))]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(x => x.status === 'rejected')).toMatchObject({ reason: { status: 401 } });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 1 });
  });
  it('converges two independent valid sign-in proofs on one wallet account', async () => {
    const f = database(), wallet = account(), a = await proof(f, wallet), b = await proof(f, wallet);
    const responses = await Promise.all([dispatch(f, request('verify', a.body)), dispatch(f, request('verify', b.body))]);
    const bodies = await Promise.all(responses.map(r => r.json())) as { user: { id: string } }[];
    expect(responses.map(r => r.status)).toEqual([200, 200]); expect(bodies[0].user.id).toBe(bodies[1].user.id);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM users WHERE wallet_address=?').get(wallet.address.toLowerCase())).toMatchObject({ n: 1 });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 2 });
  });
  it('rejects expiry and a revoked link session before changing the account', async () => {
    const f = database(), token = await createSession(f.env, 'builder'), p = await proof(f, account(), token);
    f.sqlite.exec('DELETE FROM sessions');
    await expect(dispatch(f, request('verify', p.body, token))).rejects.toMatchObject({ status: 401 });
    expect((await findUserById(f.env, 'builder'))?.walletAddress).toBeNull();
    const expired = await proof(f);
    f.sqlite.exec("UPDATE wallet_challenges SET expires_at='2000-01-01T00:00:00.000Z'");
    await expect(dispatch(f, request('verify', expired.body))).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a link session revoked between authentication and proof consumption', async () => {
    const f = database(), token = await createSession(f.env, 'builder'), p = await proof(f, account(), token);
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    vi.spyOn(f.env.DB, 'prepare').mockImplementation(sql => {
      if (sql.includes('UPDATE wallet_challenges SET consumed_at')) f.sqlite.exec('DELETE FROM sessions');
      return prepare(sql);
    });
    await expect(dispatch(f, request('verify', p.body, token))).rejects.toMatchObject({ status: 401 });
    expect((await findUserById(f.env, 'builder'))?.walletAddress).toBeNull();
  });
  it('does not overwrite a wallet linked while another approval was open', async () => {
    const f = database(), token = await createSession(f.env, 'builder'), p = await proof(f, account(), token), other = account();
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    vi.spyOn(f.env.DB, 'prepare').mockImplementation(sql => {
      if (sql.includes('UPDATE users SET wallet_address')) f.sqlite.prepare('UPDATE users SET wallet_address=? WHERE id=?').run(other.address.toLowerCase(), 'builder');
      return prepare(sql);
    });
    await expect(dispatch(f, request('verify', p.body, token))).rejects.toMatchObject({ status: 409 });
    expect((await findUserById(f.env, 'builder'))?.walletAddress).toBe(other.address.toLowerCase());
  });
  it('gives an actionable conflict for another wallet account without moving its records', async () => {
    const f = database(), wallet = account(), source = await createUserForWallet(f.env, wallet.address.toLowerCase());
    const token = await createSession(f.env, 'builder'), p = await proof(f, wallet, token);
    await expect(dispatch(f, request('verify', p.body, token))).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Log out of WAMP') });
    expect((await findUserById(f.env, source.id))?.walletAddress).toBe(wallet.address.toLowerCase());
    expect((await findUserById(f.env, 'builder'))?.walletAddress).toBeNull();
  });
  it('rejects a different wallet before asking an already-linked account to sign', async () => {
    const f = database(), token = await createSession(f.env, 'builder');
    f.sqlite.prepare("UPDATE users SET wallet_address=? WHERE id='builder'").run(account().address.toLowerCase());
    await expect(proof(f, account(), token)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Switch your wallet app') });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM wallet_challenges').get()).toMatchObject({ n: 0 });
  });
  it.each(['0x00', '0x' + 'ff'.repeat(65)])('treats an invalid signature as a failed proof (%s)', async signature => {
    const f = database(), p = await proof(f);
    await expect(dispatch(f, request('verify', { ...p.body, signature }))).rejects.toMatchObject({ status: 401 });
    expect((await dispatch(f, request('verify', p.body))).status).toBe(200);
  });
  it('rejects a wrong signer and a changed challenge message', async () => {
    const f = database(), p = await proof(f);
    const signature = await account().signMessage({ message: p.body.message });
    await expect(dispatch(f, request('verify', { ...p.body, signature }))).rejects.toMatchObject({ status: 401 });
    await expect(dispatch(f, request('verify', { ...p.body, message: p.body.message + '\nchanged' }))).rejects.toMatchObject({ status: 401 });
  });
  it.each([null, {}, { address: 3 }, { address: 'bad' }])('rejects invalid challenge bodies (%s)', async body => {
    const f = database(); await expect(dispatch(f, request('challenge', body))).rejects.toMatchObject({ status: 400 });
  });
  it('retains signed-out API sign-in without an Origin, while refusing cross-origin and originless cookie links', async () => {
    const f = database(), wallet = account(), token = await createSession(f.env, 'builder');
    expect((await dispatch(f, request('challenge', { address: wallet.address }, undefined, null))).status).toBe(200);
    await expect(dispatch(f, request('challenge', { address: wallet.address }, undefined, 'https://untrusted.example'))).rejects.toMatchObject({ status: 403 });
    await expect(dispatch(f, request('challenge', { address: wallet.address }, token, null))).rejects.toMatchObject({ status: 403 });
    await expect(dispatch(f, request('challenge', { address: wallet.address }, 'invalid-cookie'))).rejects.toMatchObject({ status: 401 });
  });
  it('requires a browser session rather than an API token', async () => {
    const f = database(), token = API_TOKEN_PREFIX + generateOpaqueToken(32);
    await createApiTokenForUser(f.env, 'builder', 'Test', await hashToken(token), ['rooms:write'], new Date().toISOString(), crypto.randomUUID());
    await expect(dispatch(f, request('challenge', { address: account().address }, undefined, 'https://wamp.land', `Bearer ${token}`))).rejects.toMatchObject({ status: 403 });
  });
  it('keeps school accounts out of wallet challenges and links', async () => {
    const f = database();
    const classroom = await createSchoolClassroom(new Request('https://wamp.land'), f.env, { slug: 'wallet-test', displayName: 'Wallet test', teacherEmail: 'teacher@example.test' });
    const { student } = await createSchoolStudent(f.env, classroom, 'student-wallet');
    const token = await createSession(f.env, student.userId);
    await expect(proof(f, account(), token)).rejects.toMatchObject({ status: 403 });
  });
});
