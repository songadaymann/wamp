import { describe, expect, it } from 'vitest';
import { parseWorldTileCliArgs, runWorldTileCli } from './world_tiles.mjs';

describe('world tile operations CLI', () => {
  it('defaults to safety and builds an immutable renderer backfill request', () => {
    const parsed = parseWorldTileCliArgs([
      'backfill',
      '--version', 'renderer-2026-07-19',
      '--render-origin', 'https://abc123.wampland.pages.dev',
      '--renderer-contract-hash', 'wamp-world-tile-render-v1',
      '--asset-contract-hash', 'assets-abc123',
    ]);
    expect(parsed.baseUrl).toContain('safety');
    expect(parsed.request.body).toMatchObject({
      version: 'renderer-2026-07-19',
      immutableRenderOrigin: true,
    });
  });

  it('requires an explicit production confirmation even for status or deploy', () => {
    expect(() => parseWorldTileCliArgs(['status', '--env', 'production'])).toThrow(
      '--confirm-production'
    );
    expect(() => parseWorldTileCliArgs(['deploy-renderer', '--env', 'production'])).toThrow(
      '--confirm-production'
    );
    expect(parseWorldTileCliArgs([
      'deploy-renderer', '--env', 'production', '--confirm-production',
    ]).productionTarget).toBe(true);
  });

  it('keeps garbage collection dry-run unless both deletion switches are present', () => {
    expect(parseWorldTileCliArgs(['garbage-collect']).request.body).toMatchObject({
      dryRun: true,
      confirm: false,
    });
    expect(() => parseWorldTileCliArgs(['garbage-collect', '--apply'])).toThrow('--confirm-delete');
    expect(parseWorldTileCliArgs([
      'garbage-collect', '--apply', '--confirm-delete', '--older-than-days', '45',
    ]).request.body).toMatchObject({ dryRun: false, confirm: true, olderThanDays: 45 });
  });

  it('sends admin status without a mutation body', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    await runWorldTileCli(['status', '--version', 'renderer-a'], {
      adminKey: 'test-key',
      print: false,
      fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
        captured = { url: String(input), init: init ?? {} };
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    expect(captured?.url).toContain('rendererVersion=renderer-a');
    expect(captured?.init.method).toBe('GET');
    expect(captured?.init.body).toBeUndefined();
  });

  it('builds the safety Wrangler deploy without allowing a production default', async () => {
    let captured: { command: string; args: string[] } | null = null;
    await runWorldTileCli(['deploy-renderer', '--env', 'safety'], {
      spawnImpl(command: string, args: string[]) {
        captured = { command, args };
        return { status: 0 };
      },
    });
    expect(captured?.command).toBe('npx');
    expect(captured?.args).toEqual([
      'wrangler', 'deploy', '--config', 'wrangler.world-tile-renderer.jsonc', '--env', 'safety',
    ]);
  });
});
