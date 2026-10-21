import { Miniflare } from 'miniflare';
import { createServer } from 'vite';
import { resolve } from 'node:path';

/** Actual API bundle and native D1. All storage and outbound traffic are isolated. */
export async function startWalletAuthFixture(bundle) {
  const loader = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [], entries: [] }, appType: 'custom', logLevel: 'error' });
  let mf, f;
  const unexpected = [];
  try {
    const { fixture } = await loader.ssrLoadModule('/src/cloudflare/worker/activity/testDatabase.ts');
    const { createSession } = await loader.ssrLoadModule('/src/cloudflare/worker/auth/store.ts');
    f = fixture();
    mf = new Miniflare({ workers: [{ name: 'wallet-auth', modules: [{ type: 'ESModule', path: resolve(bundle) }],
      compatibilityDate: '2026-03-08', compatibilityFlags: ['global_fetch_strictly_public'],
      unsafeDirectSockets: [{ host: '127.0.0.1', port: 0 }],
      bindings: { REOWN_PROJECT_ID: 'public-isolated-wallet-fixture' },
      d1Databases: { DB: 'isolated-wallet-auth', JAM_DB: 'isolated-wallet-auth' },
      serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
      outboundService: request => { unexpected.push(new URL(request.url()).origin); throw new Error('Unexpected outbound in isolated wallet auth'); },
    }] });
    const db = await mf.getD1Database('DB', 'wallet-auth');
    const schema = f.sqlite.prepare("SELECT type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid").all();
    await db.batch(schema.filter(r => r.type !== 'trigger').map(r => db.prepare(r.sql)));
    const inserts = [db.prepare('PRAGMA defer_foreign_keys = ON')];
    for (const { name } of f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      for (const row of f.sqlite.prepare(`SELECT * FROM ${quoted}`).all()) {
        const columns = Object.keys(row);
        inserts.push(db.prepare(`INSERT INTO ${quoted} (${columns.map(c => `"${c.replaceAll('"', '""')}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...Object.values(row)));
      }
    }
    await db.batch(inserts);
    await db.batch(schema.filter(r => r.type === 'trigger').map(r => db.prepare(r.sql)));
    const base = await mf.unsafeGetDirectURL('wallet-auth');
    return { db, unexpected, createSession: user => createSession({ DB: db }, user),
      call: (path, body, cookie, origin = 'https://wamp.land') => fetch(new URL(`/api/auth/${path}`, base), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: `ep_session=${cookie}` } : {}), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      close: async () => { f.sqlite.close(); await mf.dispose(); await loader.close(); },
    };
  } catch (error) { f?.sqlite.close(); await mf?.dispose(); await loader.close(); throw error; }
}
