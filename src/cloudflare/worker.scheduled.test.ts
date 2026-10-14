import type { ScheduledController } from '@cloudflare/workers-types';
import { afterEach, expect, it, vi } from 'vitest';
import worker from './worker';
import type { Env } from './worker/core/types';
import { runHourlyMaintenance } from './worker/maintenance/hourly';
import { WORLD_MAP_HEALTH_CRON } from './worker/worldTiles/health';
vi.mock('./worker/maintenance/hourly');
vi.mock('./worker/worldTiles/health', async importOriginal => ({
  ...await importOriginal<typeof import('./worker/worldTiles/health')>(), checkAndAlertWorldMap: vi.fn(),
}));
vi.mock('./worker/runs/ghostArchive');
vi.mock('./worker/runs/ghostArchiveCosts');
vi.mock('./worker/activity/emails');
vi.mock('./worker/buildPrompts/store');
vi.mock('./worker/daily/store');
vi.mock('./worker/daily/emails');
afterEach(() => vi.clearAllMocks());
it('runs expiry maintenance hourly with the event time, without repeating it for health ticks', async () => {
  const env = {} as Env;
  const scheduledTime = Date.parse('2026-10-14T01:17:00.000Z');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await worker.scheduled({ cron: WORLD_MAP_HEALTH_CRON, scheduledTime } as ScheduledController, env);
    expect(runHourlyMaintenance).not.toHaveBeenCalled();
    await worker.scheduled({ cron: '17 * * * *', scheduledTime } as ScheduledController, env);
    expect(runHourlyMaintenance).toHaveBeenCalledExactlyOnceWith(env, new Date(scheduledTime));
  } finally { vi.restoreAllMocks(); }
});
