import { describe, expect, it, vi } from 'vitest';
vi.mock('./browser', () => ({ WorldTileBrowserSession: { launch: vi.fn() } }));
import { worldTileRendererWorker } from './worker';
import type { WorldTileRendererEnv } from './runtimeTypes';
const env = { WORLD_TILE_ENVIRONMENT: 'test', WORLD_TILE_GENERATION_ENABLED: '1' } as WorldTileRendererEnv;
describe('renderer HTTP surface', () => {
  it('retains health and rejects the retired admin endpoints without using DB or admin secrets', async () => {
    expect(await (await worldTileRendererWorker.fetch(new Request('https://renderer.test/api/health'), env)).json()).toMatchObject({ ok: true, environment: 'test', generationEnabled: true });
    for (const [path, method] of [['status','GET'],['repair','POST'],['gc','POST']]) {
      const response = await worldTileRendererWorker.fetch(new Request('https://renderer.test/api/admin/'+path, { method }), env);
      expect(response.status).toBe(404);
    }
  });
});
