import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeFunctionData } from 'viem';
import { ROOM_OWNERSHIP_TOKEN_ABI } from './roomOwnership';
import { createMintRpcFixture, FIXTURE_MINT_CONTRACT as contract } from '../cloudflare/worker/mint/testRpc';

const repo = fileURLToPath(new URL('../../', import.meta.url)), cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
  await mkdir(repo+'output', { recursive: true });
  const folder = await mkdtemp(repo+'output/metadata-cli-test-'), dbPath = folder+'/cache.sqlite';
  cleanup.push(() => rm(folder, { recursive: true, force: true }));
  const db = new DatabaseSync(dbPath); cleanup.push(async () => db.close());
  db.exec(`CREATE TABLE rooms(id TEXT PRIMARY KEY,x INTEGER,y INTEGER,minted_chain_id INTEGER,minted_contract_address TEXT,minted_token_id TEXT,minted_metadata_room_version INTEGER,minted_metadata_hash TEXT,minted_metadata_updated_at TEXT,claimer_user_id TEXT,title TEXT)`);
  db.prepare('INSERT INTO rooms VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('0,0',0,0,8453,contract,'42',null,null,null,'builder','Room');
  db.prepare('INSERT INTO rooms VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('1,1',1,1,8453,contract,'99',2,'untouched','yesterday','other-builder','Other room');
  const peer=createMintRpcFixture(8453,42n);
  const uri=(v:number)=>'data:application/json;base64,'+Buffer.from(JSON.stringify({wamp_room:{v:4,c:[0,0],b:'blue',pv:v}})).toString('base64');
  peer.state.tokenUri=uri(6); let beforeUriRead: (()=>void)|null=null;
  const server=createServer(async (request,response)=>{
    try {
      const chunks:Buffer[]=[];for await(const part of request)chunks.push(Buffer.from(part));const body=Buffer.concat(chunks).toString();const q=JSON.parse(body);
      if(q.method==='eth_call'&&decodeFunctionData({abi:ROOM_OWNERSHIP_TOKEN_ABI,data:q.params[0].data}).functionName==='tokenURI')beforeUriRead?.();
      const result=await peer.fetch('http://fixture.invalid',{method:'POST',body});response.writeHead(result.status,{'Content-Type':'application/json'});response.end(await result.text());
    }catch(error){response.writeHead(500);response.end(String(error));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Missing fixture port');
  const cli=folder+'/wrangler.cjs';await writeFile(cli,`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(dbPath)});try{const sql=process.argv[process.argv.indexOf('--command')+1];console.log(JSON.stringify([{success:true,results:db.prepare(sql).all()}]));}finally{db.close();}`);
  const plan=folder+'/plan.json',receipt=folder+'/receipt.json';
  const common=[`--rpc=http://127.0.0.1:${address.port}`,`--wrangler=${cli}`];
  const run=(args:string[])=>new Promise<{code:number|null;out:string;err:string}>(resolve=>{
    const child=spawn(process.execPath,['--import','tsx',repo+'scripts/reconcile-room-token-cache.ts',...common,...args],{cwd:repo});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',code=>resolve({code,out,err}));
  });
  const dry=()=>run(['--database=fixture','--chain=8453',`--contract=${contract}`,'--room=0,0',`--output=${relative(repo,plan)}`]);
  const apply=async (approve?:string)=>run([`--apply-plan=${relative(repo,plan)}`,`--approve=${approve??createHash('sha256').update(await readFile(plan)).digest('hex')}`,`--output=${relative(repo,receipt)}`]);
  const rows=()=>db.prepare('SELECT * FROM rooms ORDER BY id').all();
  return {db,peer,dry,apply,rows,uri,receipt,setBeforeUriRead:(f:()=>void)=>{beforeUriRead=f;}};
}

describe('keyless artwork cache repair command, real subprocess/SQLite/RPC',()=>{
  it('defaults to read-only, then applies only the reviewed metadata fields and verifies the receipt',async()=>{
    const f=await setup(),before=f.rows();const dry=await f.dry();expect(dry.code,dry.err).toBe(0);expect(JSON.parse(dry.out)).toMatchObject({dryRun:true,proposedRows:1,rowsWritten:0,onChainTransactions:0});expect(f.rows()).toEqual(before);
    const applied=await f.apply();expect(applied.code,applied.err).toBe(0);const after=f.rows();expect(after[0]).toMatchObject({minted_metadata_room_version:6,claimer_user_id:'builder',title:'Room'});expect(after[1]).toEqual(before[1]);
    expect(JSON.parse(await readFile(f.receipt,'utf8'))).toMatchObject({accepted:true,applied:['0,0'],onChainTransactions:0,signingKeysRead:false});expect(f.peer.methods.every(m=>['eth_chainId','eth_blockNumber','eth_call'].includes(m))).toBe(true);
  },30000);
  it('rejects the wrong plan digest before RPC/database access',async()=>{
    const f=await setup();expect((await f.dry()).code).toBe(0);const before=f.rows(),calls=f.peer.methods.length;expect((await f.apply('0'.repeat(64))).code).toBe(1);expect(f.rows()).toEqual(before);expect(f.peer.methods).toHaveLength(calls);
  },30000);
  it('refuses to apply when the chain changed after the dry run',async()=>{
    const f=await setup();expect((await f.dry()).code).toBe(0);const before=f.rows();f.peer.state.tokenUri=f.uri(7);const result=await f.apply();expect(result.code).toBe(1);expect(f.rows()).toEqual(before);
  },30000);
  it('keeps a concurrent cache update and leaves an honest pending receipt',async()=>{
    const f=await setup();expect((await f.dry()).code).toBe(0);f.setBeforeUriRead(()=>{f.db.prepare('UPDATE rooms SET minted_metadata_hash=? WHERE id=?').run('newer','0,0');});const result=await f.apply();expect(result.code).toBe(1);expect(f.rows()[0]).toMatchObject({minted_metadata_hash:'newer',minted_metadata_room_version:null});expect(JSON.parse(await readFile(f.receipt,'utf8'))).toMatchObject({accepted:false,applied:[],pendingRoom:'0,0'});
  },30000);
});
