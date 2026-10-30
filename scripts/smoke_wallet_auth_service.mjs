import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { startWalletAuthFixture } from './lib/walletAuthServiceFixture.mjs';

const output = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'output/web-game/wallet-auth-service';
mkdirSync(output, { recursive: true });
if (!process.argv.includes('--skip-build')) {
  for (const [command, args, log] of [['npm', ['run', 'build'], 'build.log'], [process.execPath,
    ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', `${output}/api`], 'bundle.log']]) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    writeFileSync(`${output}/${log}`, (result.stdout || '') + (result.stderr || '')); assert.equal(result.status, 0, log);
  }
}
const service = await startWalletAuthFixture(`${output}/api/worker.js`), cases = [];
try {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const stale = await service.call('session', undefined, 'expired-wallet-fixture-cookie');
  assert.equal(stale.status, 200); assert.match(stale.headers.get('set-cookie'), /Max-Age=0/); cases.push('stale-cookie-cleared');
  const changedBeforeProof = await service.call('wallet/challenge', { address: wallet.address, expectedUserId: 'builder' });
  assert.equal(changedBeforeProof.status, 409); cases.push('expected-account-before-proof');
  const proof = async cookie => {
    const response = await service.call('wallet/challenge', { address: wallet.address }, cookie);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const challenge = await response.json();
    return { address: wallet.address, message: challenge.message, signature: await wallet.signMessage({ message: challenge.message }) };
  };
  const signedOut = await proof(), first = await service.call('wallet/verify', signedOut);
  assert.equal(first.status, 200, await first.clone().text());
  assert(first.headers.get('set-cookie')); const source = (await first.json()).user;
  const repeated = await service.call('wallet/verify', signedOut); assert.equal(repeated.status, 401); cases.push('sign-in-and-replay');
  const token = await service.createSession('builder'), link = await proof(token);
  assert(link.message.includes('Link this wallet')); assert(link.message.includes('builder (builder)'));
  const conflict = await service.call('wallet/verify', link, token), conflictText = await conflict.text();
  assert.equal(conflict.status, 409); assert(conflictText.includes('Log out of WAMP')); cases.push('other-account-conflict');
  assert.equal((await service.db.prepare('SELECT wallet_address FROM users WHERE id=?').bind(source.id).first()).wallet_address, wallet.address.toLowerCase());
  const other = privateKeyToAccount(generatePrivateKey());
  const response = await service.call('wallet/challenge', { address: other.address }, token), challenge = await response.json();
  const body = { address: other.address, message: challenge.message, signature: await other.signMessage({ message: challenge.message }) };
  const otherSession = await service.createSession('builder');
  assert.equal((await service.call('wallet/verify', body, otherSession)).status, 409); cases.push('same-user-different-session');
  assert.equal((await service.call('wallet/verify', body)).status, 409); cases.push('link-cannot-sign-in');
  const raced = await Promise.all([service.call('wallet/verify', body, token), service.call('wallet/verify', body, token)]);
  assert.deepEqual(raced.map(r => r.status).sort(), [200, 401]); cases.push('native-d1-single-consumer');
  assert.equal((await service.db.prepare("SELECT wallet_address FROM users WHERE id='builder'").first()).wallet_address, other.address.toLowerCase());
  const original = await proof();
  assert.equal((await service.call('wallet/verify', original, token)).status, 409); cases.push('sign-in-cannot-link');
  assert.equal((await service.call('wallet/verify', { ...original, signature: '0x00' })).status, 401); cases.push('malformed-signature');
  assert.equal((await service.call('wallet/verify', original)).status, 200);
  assert.equal((await service.call('wallet/challenge', { address: wallet.address }, token)).status, 409); cases.push('existing-wallet-preserved');
  for (const path of ['wallet/challenge', 'wallet/verify']) {
    assert.equal((await service.call(path, { address: wallet.address }, token, 'https://untrusted.example')).status, 403);
    cases.push(path + '-origin');
  }
  assert.deepEqual(service.unexpected, []);
  writeFileSync(`${output}/report.json`, JSON.stringify({ accepted: true, cases, realKeysUsed: false,
    productionRequests: 0, transactionsSubmitted: 0, unexpectedOutbound: service.unexpected }, null, 2));
  process.stdout.write(`wallet authentication service: ${cases.length} native API checks passed\n`);
} finally { await service.close(); }
