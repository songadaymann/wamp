import { describe, expect, it } from 'vitest';
import {
  captureWorldTileRolloutSearch,
  decideWorldTileRollout,
  getOrCreateWorldTileCohortId,
  getWorldTileCohortBucket,
} from './rollout';
import type { WorldTileConfig } from './types';

const config: WorldTileConfig = {
  schemaVersion: 1,
  available: true,
  rolloutPercentage: 50,
  activeRendererVersion: 'renderer-v1',
};

describe('world tile rollout cohort', () => {
  it('captures only a normalized page-session rollout override', () => {
    expect(captureWorldTileRolloutSearch('?worldTiles=FORCE&deploy=abc')).toBe('?worldTiles=force');
    expect(captureWorldTileRolloutSearch('?worldTiles=shadow&x=4')).toBe('?worldTiles=shadow');
    expect(captureWorldTileRolloutSearch('?worldTiles=off')).toBe('?worldTiles=off');
    expect(captureWorldTileRolloutSearch('?worldTiles=unknown')).toBe('');
  });

  it('persists one anonymous cohort id', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const first = getOrCreateWorldTileCohortId(storage);
    expect(getOrCreateWorldTileCohortId(storage)).toBe(first);
  });

  it('assigns a deterministic percentage bucket', () => {
    expect(getWorldTileCohortBucket('stable-user')).toBe(getWorldTileCohortBucket('stable-user'));
    expect(getWorldTileCohortBucket('stable-user')).toBeGreaterThanOrEqual(0);
    expect(getWorldTileCohortBucket('stable-user')).toBeLessThan(100);
  });

  it('allows public QA force without bypassing API availability', () => {
    expect(decideWorldTileRollout({ config, cohortId: 'qa', search: '?worldTiles=force' }))
      .toMatchObject({ enabled: true, forced: true });
    expect(decideWorldTileRollout({
      config: { ...config, available: false },
      cohortId: 'qa',
      search: '?worldTiles=force',
    })).toMatchObject({ enabled: false, reason: 'unavailable' });
  });

  it('supports shadow QA at zero rollout without changing the visible renderer', () => {
    expect(decideWorldTileRollout({
      config: { ...config, rolloutPercentage: 0 },
      cohortId: 'qa',
      search: '?worldTiles=shadow',
    })).toMatchObject({ enabled: true, shadow: true, forced: false });
  });

  it('supports a session opt-out and stable percentage selection', () => {
    expect(decideWorldTileRollout({ config, cohortId: 'qa', search: '?worldTiles=off' }))
      .toMatchObject({ enabled: false, reason: 'query-disabled' });
    const bucket = getWorldTileCohortBucket('known-cohort');
    expect(decideWorldTileRollout({
      config: { ...config, rolloutPercentage: bucket },
      cohortId: 'known-cohort',
    }).enabled).toBe(false);
    expect(decideWorldTileRollout({
      config: { ...config, rolloutPercentage: Math.min(100, bucket + 0.01) },
      cohortId: 'known-cohort',
    }).enabled).toBe(true);
  });

  it('turns an existing cohort off when a refreshed rollout drops to zero', () => {
    const cohortId = 'existing-enabled-session';
    expect(decideWorldTileRollout({
      config: { ...config, rolloutPercentage: 100 },
      cohortId,
    }).enabled).toBe(true);
    expect(decideWorldTileRollout({
      config: { ...config, rolloutPercentage: 0 },
      cohortId,
    })).toMatchObject({ enabled: false, reason: 'outside-cohort' });
  });
});
