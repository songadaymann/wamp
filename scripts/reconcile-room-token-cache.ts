/** Read-only by default. Reconciles D1 artwork cache only; never loads a signing key or sends a transaction. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, isAddress, type Address } from 'viem';
import { ROOM_OWNERSHIP_TOKEN_ABI } from '../src/mint/roomOwnership';
import { getRoomMintNetwork } from '../src/mint/roomNetwork';
import { observeRoomTokenMetadata } from '../src/mint/roomMetadataObservation';

interface CacheRow {
  id: string; x: number; y: number; minted_chain_id: number; minted_contract_address: string; minted_token_id: string;
  minted_metadata_room_version: number | null; minted_metadata_hash: string | null; minted_metadata_updated_at: string | null;
}
interface Target { before: CacheRow; version: number | null; hash: string }
interface Plan { schema: 1; database: string; chainId: number; contract: Address; observedBlock: string; observedAt: string; targets: Target[] }
const repo = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), value = (key: string) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
if (args.includes('--help')) {
  console.log('Dry run: npx tsx scripts/reconcile-room-token-cache.ts --database=NAME --chain=8453 --contract=0x... --output=output/cache-plan.json [--rpc=https://PUBLIC_RPC] [--room=X,Y ...]\nApply reviewed plan: add --apply-plan=output/cache-plan.json --approve=SHA256; target identities and current chain hashes are reverified before every guarded cache update. No on-chain transaction is submitted.');
} else {
  const applyPath = value('apply-plan'), output = resolve(repo, value('output') || (applyPath ? 'output/room-token-cache-receipt.json' : 'output/room-token-cache-plan.json'));
  assert(relative(resolve(repo, 'output'), output) && !relative(resolve(repo, 'output'), output).startsWith('..'), 'Keep personal cache evidence under ignored output/');
  let plan: Plan | null = null;
  if (applyPath) {
    assert.notEqual(output, resolve(repo, applyPath), 'Use a separate output file for the apply receipt');
    const bytes = await readFile(resolve(repo, applyPath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), value('approve'), 'Pass the SHA256 of the exact reviewed plan');
    plan = JSON.parse(bytes.toString()) as Plan; assert.equal(plan.schema, 1); assert(Array.isArray(plan.targets));
  }
  const database = plan?.database ?? value('database') ?? '', chainId = plan?.chainId ?? Number(value('chain'));
  const contract = plan?.contract ?? value('contract') ?? '';
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(database), 'Explicit D1 database name required');
  assert(getRoomMintNetwork(chainId), 'Explicit supported chain required'); assert(isAddress(contract), 'Explicit contract required');
  const rpc = value('rpc') || getRoomMintNetwork(chainId)!.rpcUrl;
  const rpcUrl = new URL(rpc); assert(!rpcUrl.username && !rpcUrl.password, 'Use a public RPC URL without embedded credentials');
  const client = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 10_000 }) });
  assert.equal(await client.getChainId(), chainId, 'RPC network mismatch');
  const cli = resolve(repo, value('wrangler') || 'node_modules/wrangler/bin/wrangler.js');
  const query = (sql: string): CacheRow[] => {
    const raw = execFileSync(process.execPath, [cli, 'd1', 'execute', database, '--remote', '--json', '--command', sql], { cwd: repo, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(raw) as { success: boolean; results: CacheRow[] }[];
    assert.equal(result.length, 1); assert(result[0].success); return result[0].results;
  };
  const quote = (v: string | number | null) => v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`;
  const columns = 'id,x,y,minted_chain_id,minted_contract_address,minted_token_id,minted_metadata_room_version,minted_metadata_hash,minted_metadata_updated_at';
  const readRows = () => query(`SELECT ${columns} FROM rooms WHERE minted_chain_id=${chainId} AND LOWER(minted_contract_address)=${quote(contract.toLowerCase())} ORDER BY CAST(minted_token_id AS INTEGER)`);
  const observe = async (row: CacheRow, blockNumber: bigint) => {
    assert.equal(row.id, `${row.x},${row.y}`); assert(Number.isSafeInteger(row.x) && Number.isSafeInteger(row.y));
    assert.equal(row.minted_chain_id, chainId); assert.equal(row.minted_contract_address.toLowerCase(), contract.toLowerCase());
    const tokenId = await client.readContract({ address: contract, abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'tokenIdForRoomCoordinates', args: [row.x, row.y], blockNumber });
    assert(tokenId > 0n); assert.equal(String(tokenId), row.minted_token_id, 'Room/token mapping changed');
    const uri = await client.readContract({ address: contract, abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'tokenURI', args: [tokenId], blockNumber });
    return observeRoomTokenMetadata(uri, { x: row.x, y: row.y });
  };
  const beforeAll = readRows(), applied: string[] = [];
  if (plan) {
    await mkdir(dirname(output), { recursive: true });
    const checkpoint = async (pendingRoom: string | null) => writeFile(output, JSON.stringify({ accepted: false, at: new Date().toISOString(), applied, pendingRoom, beforeAll, onChainTransactions: 0, signingKeysRead: false }, null, 2));
    await checkpoint(null);
    for (const target of plan.targets) {
      assert(/^[a-f0-9]{64}$/.test(target.hash)); assert(target.version === null || Number.isSafeInteger(target.version) && target.version > 0);
      const current = readRows().find(r => r.id === target.before.id); assert.deepEqual(current, target.before, 'Cache changed since the reviewed plan');
      const observed = await observe(current!, await client.getBlockNumber({ cacheTime: 0 }));
      assert.equal(observed.metadataHash, target.hash); assert.equal(observed.metadataRoomVersion, target.version, 'Chain artwork changed since review');
      const guard = Object.entries(target.before).map(([k, v]) => `${k} IS ${quote(v)}`).join(' AND ');
      await checkpoint(target.before.id);
      const result = query(`UPDATE rooms SET minted_metadata_room_version=${quote(target.version)},minted_metadata_hash=${quote(target.hash)},minted_metadata_updated_at=${quote(new Date().toISOString())} WHERE ${guard} RETURNING ${columns}`);
      assert.equal(result.length, 1, 'Concurrent cache change; update was not applied'); applied.push(target.before.id);
      await checkpoint(target.before.id);
      const saved = readRows().find(r => r.id === target.before.id)!; assert.equal(saved.minted_metadata_hash, observed.metadataHash); assert.equal(saved.minted_metadata_room_version, observed.metadataRoomVersion);
      const chainAfter = await observe(saved, await client.getBlockNumber({ cacheTime: 0 }));
      assert.equal(chainAfter.metadataHash, saved.minted_metadata_hash, 'Chain artwork changed during apply; reconcile again');
      assert.equal(chainAfter.metadataRoomVersion, saved.minted_metadata_room_version);
      await checkpoint(null);
    }
    const afterAll = readRows();
    assert.deepEqual(afterAll.filter(r => !applied.includes(r.id)), beforeAll.filter(r => !applied.includes(r.id)), 'Non-target cache changed');
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify({ accepted: true, at: new Date().toISOString(), applied, beforeAll, afterAll, onChainTransactions: 0, signingKeysRead: false }, null, 2));
    console.log(JSON.stringify({ appliedRows: applied.length, report: relative(repo, output), onChainTransactions: 0 }));
  } else {
    const rooms = args.filter(a => a.startsWith('--room=')).map(a => a.slice(7)); for (const room of rooms) assert(/^-?\d+,-?\d+$/.test(room), 'Use canonical room coordinates');
    const block = await client.getBlockNumber({ cacheTime: 0 }), targets: Target[] = [], observations = [];
    for (const row of beforeAll.filter(r => !rooms.length || rooms.includes(r.id))) {
      const observed = await observe(row, block); observations.push({ id: row.id, tokenId: row.minted_token_id, ...observed });
      if (row.minted_metadata_hash !== observed.metadataHash || row.minted_metadata_room_version !== observed.metadataRoomVersion) targets.push({ before: row, hash: observed.metadataHash, version: observed.metadataRoomVersion });
    }
    for (const room of rooms) assert(observations.some(r => r.id === room), 'Requested room mapping missing');
    const proposed: Plan = { schema: 1, database, chainId, contract, observedBlock: String(block), observedAt: new Date().toISOString(), targets };
    const bytes = JSON.stringify(proposed, null, 2) + '\n'; await mkdir(dirname(output), { recursive: true }); await writeFile(output, bytes);
    await writeFile(output.replace(/\.json$/, '') + '-audit.json', JSON.stringify({ observations, beforeAll, rowsWritten: 0, onChainTransactions: 0, signingKeysRead: false }, null, 2));
    console.log(JSON.stringify({ dryRun: true, observedRooms: observations.length, proposedRows: targets.length, plan: relative(repo, output), sha256: createHash('sha256').update(bytes).digest('hex'), rowsWritten: 0, onChainTransactions: 0 }));
  }
}
