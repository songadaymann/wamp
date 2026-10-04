import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../../../worldTiles/assetContract';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { checkAndAlertWorldMap, loadWorldMapHealthStatus, worldMapAlertsConfigured } from './health';

class Statement implements D1PreparedStatement {
  values: (string | number | null)[] = [];
  constructor(readonly db: DatabaseSync, readonly sql: string) {}
  bind(...values: unknown[]): this { this.values = values as (string | number | null)[]; return this; }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.rows() as T[] }; }
  rows() { return this.db.prepare(this.sql).all(...this.values); }
}
class Database implements D1Database {
  failAckOnce = false;
  constructor(readonly sqlite: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(this.sqlite, sql); }
  async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
    this.sqlite.exec('BEGIN');
    try {
      const rows = statements.map(statement => {
        if (!(statement instanceof Statement)) throw new Error('Unexpected statement');
        if (this.failAckOnce && statement.sql.includes('SET sent_at =')) { this.failAckOnce = false; throw new Error('Temporary database failure'); }
        return statement.rows() as T;
      });
      this.sqlite.exec('COMMIT'); return rows;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

const NOW = '2026-10-04T01:00:00.000Z';
const later = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();
const healthyConfig = () => ({ schemaVersion: 1, available: true, rolloutPercentage: 100, activeRendererVersion: 'renderer-good',
  activeRendererAssetContractHash: WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH, expectedRendererAssetContractHash: WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH });

describe('direct world map alerts with durable delivery', () => {
  let sqlite: DatabaseSync; let database: Database; let env: Env;
  let config = healthyConfig(); let apiStatus = 200; let mailStatus = 200;
  let attempts: { key: string; body: string }[]; let deliveries: Map<string, string>;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://api.wamp.land/')) return new Response(JSON.stringify(config), { status: apiStatus });
    expect(url).toBe('https://api.resend.com/emails');
    const key = new Headers(init?.headers).get('Idempotency-Key')!;
    const body = String(init?.body); attempts.push({ key, body });
    if (mailStatus !== 200) return new Response('{}', { status: mailStatus });
    if (deliveries.has(key)) expect(body).toBe(deliveries.get(key));
    deliveries.set(key, body);
    return new Response(JSON.stringify({ id: `email-${key}` }));
  };
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../../../migrations/0051_world_map_health_alerts.sql', import.meta.url), 'utf8'));
    database = new Database(sqlite);
    env = { ASSETS: { fetch: async () => new Response('test') }, JAM_DB: database, DB: database, WORLD_MAP_HEALTH_ALERTS_ENABLED: '1', WORLD_MAP_ALERT_EMAIL: 'owner@example.test', RESEND_API_KEY: 'test-secret' };
    config = healthyConfig(); apiStatus = 200; mailStatus = 200; attempts = []; deliveries = new Map();
  });
  afterEach(() => sqlite.close());
  const check = (now = NOW) => checkAndAlertWorldMap(env, { now, fetcher });
  const events = () => sqlite.prepare('SELECT kind, sent_at, attempts FROM world_map_health_alerts ORDER BY rowid').all() as { kind: string; sent_at: string | null; attempts: number }[];

  it('routes same-zone health requests through the public Worker and keeps maintenance separate', () => {
    const config = readFileSync(new URL('../../../../wrangler.jsonc', import.meta.url), 'utf8');
    expect(config).toMatch(/"compatibility_flags"\s*:\s*\["global_fetch_strictly_public"\]/);
    expect(config).toContain('"17 * * * *"');
    expect(config).toContain('"7,22,37,52 * * * *"');
  });

  it('stays quiet while healthy; sends one outage, a daily reminder, and recovery', async () => {
    await check(); expect(deliveries.size).toBe(0);
    config.available = false; await check(later(15)); await check(later(30));
    expect(deliveries.size).toBe(1);
    await check(later(15 + 24 * 60)); expect(deliveries.size).toBe(2);
    config.available = true; await check(later(15 + 24 * 60 + 15));
    expect(events().map(event => event.kind)).toEqual(['outage', 'reminder', 'recovery']);
    expect(deliveries.size).toBe(3);
    const message = JSON.parse(attempts[0].body);
    expect(message.to).toBe('owner@example.test');
    expect(message.text).toContain('rebuild and verify imagery');
    expect(attempts[0].body).not.toContain('test-secret');
  });
  it('alerts when a new catalog fingerprint makes old imagery incompatible', async () => {
    config.activeRendererAssetContractHash = 'old-catalog';
    const result = await check();
    expect(result.status).toBe('unhealthy'); expect(deliveries.size).toBe(1);
  });
  it('alerts for an HTTP outage', async () => {
    apiStatus = 503; await check();
    expect(JSON.parse(attempts[0].body).text).toContain('HTTP 503');
  });
  it('alerts for a network failure rather than losing the observation', async () => {
    const failingFetcher: typeof fetch = (input, init) => String(input).startsWith('https://api.wamp.land/')
      ? Promise.reject(new Error('Network unavailable')) : fetcher(input, init);
    expect((await checkAndAlertWorldMap(env, { now: NOW, fetcher: failingFetcher })).status).toBe('unhealthy');
    expect(deliveries.size).toBe(1);
  });
  it('retries rejected email without marking it delivered or creating another outage', async () => {
    config.available = false; mailStatus = 503;
    await expect(check()).rejects.toThrow('email provider returned HTTP 503');
    expect(events()[0].sent_at).toBeNull();
    mailStatus = 200; await check(later(15));
    expect(events()).toHaveLength(1); expect(deliveries.size).toBe(1);
    expect(attempts[1]).toEqual(attempts[0]);
  });
  it('uses the same provider idempotency key and body after a database acknowledgement fails', async () => {
    config.available = false; database.failAckOnce = true;
    await expect(check()).rejects.toThrow('Temporary database failure');
    await check(later(15));
    expect(attempts).toHaveLength(2); expect(deliveries.size).toBe(1);
    expect(events()[0].attempts).toBe(2);
  });
  it('deduplicates concurrent observations and delivery claims', async () => {
    config.available = false;
    await Promise.all([check(), check()]);
    expect(events()).toHaveLength(1); expect(deliveries.size).toBe(1);
  });
  it('reclaims an expired delivery lease after a crashed run', async () => {
    config.available = false; mailStatus = 503;
    await expect(check()).rejects.toThrow();
    sqlite.prepare('UPDATE world_map_health_alerts SET lease_token = ?, lease_until = ?').run('crashed-worker', later(2));
    mailStatus = 200; await check(later(1)); expect(deliveries.size).toBe(0);
    await check(later(15)); expect(deliveries.size).toBe(1);
  });
  it('sends an explicitly labelled test once without manufacturing an outage', async () => {
    const options = { now: NOW, fetcher, testId: 'setup-20261004' };
    await checkAndAlertWorldMap(env, options); await checkAndAlertWorldMap(env, { ...options, now: later(15) });
    expect(events().map(event => event.kind)).toEqual(['test']); expect(deliveries.size).toBe(1);
    expect(JSON.parse(attempts[0].body).subject).toBe('[WAMP] Fast-map alerts are enabled');
    expect((await loadWorldMapHealthStatus(env)).pendingAlerts).toBe(0);
  });
  it('does not send production alerts from safety or when disabled', async () => {
    env.WORLD_MAP_HEALTH_ALERTS_ENABLED = undefined;
    expect(await check()).toEqual({ enabled: false, status: 'disabled', sent: 0 }); expect(attempts).toHaveLength(0);
  });
  it('fails visibly if the email delivery configuration is missing', async () => {
    env.RESEND_API_KEY = undefined;
    expect(worldMapAlertsConfigured(env)).toBe(false);
    await expect(check()).rejects.toThrow('valid recipient and RESEND_API_KEY');
  });
});
