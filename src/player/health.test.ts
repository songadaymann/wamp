import { getPlayableMaximumHearts } from './hearts';
import { describe, expect, it } from 'vitest';
import { PlayerHealth } from './health';

describe('room health across contacts, pickups and spawns', () => {
  it('retains one-hit deaths by default', () => {
    const health = new PlayerHealth();
    expect(health.damage(0)).toBe('death');
    expect(health.current).toBe(0);
    expect(health.heal()).toBe(false);
  });

  it('loses one heart for a burst of overlapping hazards, then accepts a later hit', () => {
    const health = new PlayerHealth(); health.reset(3);
    expect(health.damage(100)).toBe('hurt');
    expect(health.damage(100)).toBe('ignored');
    expect(health.damage(1099)).toBe('ignored');
    expect(health.current).toBe(2);
    expect(health.damage(1100)).toBe('hurt');
    expect(health.damage(2100)).toBe('death');
    expect(health.current).toBe(0);
  });

  it('heals one heart up to the maximum without extending damage protection', () => {
    const health = new PlayerHealth(); health.reset(3); health.damage(50);
    expect(health.heal()).toBe(true);
    expect(health.current).toBe(3);
    expect(health.heal()).toBe(false);
    expect(health.invulnerableUntil).toBe(1050);
  });

  it('clamps between rooms without granting free healing on a cell transition', () => {
    const health = new PlayerHealth(); health.reset(3); health.damage(0);
    health.setMaximum(3); expect(health.current).toBe(2);
    health.setMaximum(1); expect(health.current).toBe(1);
    health.setMaximum(3); expect(health.current).toBe(1);
  });

  it('a deadly fall ignores remaining hearts and protection', () => {
    const health = new PlayerHealth(); health.reset(3); health.damage(10);
    health.die();
    expect(health.current).toBe(0);
    expect(health.invulnerableUntil).toBe(0);
    health.setMaximum(3); expect(health.heal()).toBe(false);
  });

  it('refills and clears damage protection at respawn or a fresh play session', () => {
    const health = new PlayerHealth(); health.reset(3); health.damage(500);
    health.reset(3);
    expect(health.current).toBe(3);
    expect(health.damage(501)).toBe('hurt');
    health.reset(undefined);
    expect(health.current).toBe(1);
    expect(health.invulnerableUntil).toBe(0);
  });
});


describe('playable heart setting authority', () => {
  it('uses the exact standalone snapshot, including when its lightweight summary has no setting', () => {
    expect(getPlayableMaximumHearts({ room: { playerHearts: 3 }, course: null,
      expandedRoom: { source: 'standalone_room' } })).toBe(3);
  });
  it('uses a shared root across cells and treats a missing root setting as one', () => {
    for (const source of ['native_expanded_room', 'legacy_course']) {
      expect(getPlayableMaximumHearts({ room: { playerHearts: 1 }, course: null,
        expandedRoom: { source, playerHearts: 3 } })).toBe(3);
      expect(getPlayableMaximumHearts({ room: { playerHearts: 3 }, course: null,
        expandedRoom: { source } })).toBe(1);
    }
    expect(getPlayableMaximumHearts({ room: { playerHearts: 3 }, course: {},
      expandedRoom: { source: 'native_expanded_room', playerHearts: 3 } })).toBe(1);
    expect(getPlayableMaximumHearts({ room: { playerHearts: 1 }, course: { playerHearts: 2 },
      expandedRoom: { source: 'native_expanded_room', playerHearts: 3 } })).toBe(2);
  });
});
