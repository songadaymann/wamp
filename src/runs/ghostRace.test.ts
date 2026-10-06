import { describe, expect, it } from 'vitest';
import { buildRunGhost, GhostRacePlayback, normalizeRunGhost, supportsGhostRace, type GhostPoint, type RunGhost } from './ghostRace';
import type { RankedRunVerificationTrace } from './verificationTrace';
import { loadLocalGhostBest, saveLocalGhostBest } from './localGhostBest';
const point = (atMs: number, x: number, extra: Partial<GhostPoint> = {}): GhostPoint =>
  ({ atMs, x, y: 100, roomX: 1, roomY: 2, vx: 100, vy: 0, grounded: true, snap: false, ...extra });
const ghost = (extra: Partial<RunGhost> = {}): RunGhost => ({ schemaVersion: 1, attemptId: 'attempt', roomId: '1,2',
  roomVersion: 1, displayName: 'Leader', avatarId: 'default-player', elapsedMs: 1000,
  points: [point(0, 0), point(250, 25), point(1000, 100)], ...extra });
const trace = (): RankedRunVerificationTrace => ({ schemaVersion: 1, verificationNonce: 'private-nonce',
  snapshotHash: 'private-hash', traceDurationMs: 1000, inputEvents: [{ atMs: 0, control: 'jump', value: true }],
  breadcrumbs: ghost().points, roomTransitions: [], goalEvents: [] });

describe('movement-only ghosts', () => {
  it('strips private trace data and unknown breadcrumb fields, without changing sampling', () => {
    const result = buildRunGhost(ghost(), trace())!;
    expect(Object.keys(result)).toEqual(['schemaVersion', 'attemptId', 'roomId', 'roomVersion', 'displayName', 'avatarId', 'elapsedMs', 'points']);
    expect(JSON.stringify(result)).not.toMatch(/nonce|snapshotHash|inputEvents|goalEvents/);
    expect(result.points.map(p => p.atMs)).toEqual([0, 250, 1000]);
    expect(normalizeRunGhost({ ...result, image: 'private screenshot' })).toEqual(result);
  });
  it('rejects oversized, invalid and nonmonotonic recordings', () => {
    expect(normalizeRunGhost(ghost({ points: [point(250, 0), point(0, 1)] }))).toBeNull();
    expect(normalizeRunGhost(ghost({ points: [point(0, Infinity), point(1000, 10)] }))).toBeNull();
    expect(buildRunGhost(ghost(), { ...trace(), breadcrumbs: Array.from({ length: 2049 }, (_, i) => point(i, i)) })).toBeNull();
  });
  it('records an explicit final location and respawn breaks', () => {
    const t = trace();
    t.respawnEvents = [{ atMs: 250, breadcrumbIndex: 1, goalEventCount: 0,
      fromRoomX: 1, fromRoomY: 2, fromX: 0, fromY: 100, kind: 'start', instanceId: null, checkpointIndex: null }];
    t.goalEvents = [{ atMs: 1000, type: 'complete', actor: 'player', roomId: '1,2',
      roomX: 1, roomY: 2, x: 120, y: 100, instanceId: null, checkpointIndex: null }];
    const result = buildRunGhost(ghost(), t)!;
    expect(result.points[1].snap).toBe(true);
    expect(new GhostRacePlayback(result).sample(1000).x).toBe(120);
  });
  it('limits racing to time-ranked goals', () => {
    expect(supportsGhostRace({ type: 'reach_exit', exit: { x: 10, y: 10 }, timeLimitMs: null })).toBe(true);
    expect(supportsGhostRace({ type: 'survival', durationMs: 1000 })).toBe(false);
    expect(supportsGhostRace(null)).toBe(false);
  });
  it('snaps short same-room teleports and continues smoothly after a room seam', () => {
    const t = trace();
    t.breadcrumbs = [point(0, 0), point(250, 150), point(750, 25, { roomX: 2 })];
    t.roomTransitions = [{ atMs: 500, fromRoomX: 1, fromRoomY: 2, toRoomX: 2, toRoomY: 2, x: 0, y: 100 }];
    const playback = new GhostRacePlayback(buildRunGhost(ghost(), t)!);
    expect(playback.sample(249).x).toBe(0);
    expect(playback.sample(250).x).toBe(150);
    expect(playback.sample(500)).toMatchObject({ roomX: 2, x: 0 });
    expect(playback.sample(625).x).toBeGreaterThan(0);
    expect(playback.sample(625).x).toBeLessThan(25);
  });
});
describe('ghost timing', () => {
  it('aligns movement and finish with the ranked time without changing Hermite geometry', () => {
    const t = trace();
    t.goalEvents = [{ atMs: 1000, type: 'complete', actor: 'player', roomId: '1,2',
      roomX: 1, roomY: 2, x: 100, y: 100, instanceId: null, checkpointIndex: null }];
    const recording = buildRunGhost(ghost({ elapsedMs: 2000 }), t)!;
    expect(recording.points.map(point => point.atMs)).toEqual([0, 500, 2000, 2000]);
    expect(recording.points[0].vx).toBe(50);
    const playback = new GhostRacePlayback(recording);
    expect(playback.sample(250).x).toBeCloseTo(12.5);
    expect(playback.sample(2000).x).toBe(100);
    expect(buildRunGhost(ghost(), { ...t, traceDurationMs: 0 })).toBeNull();
  });
  it('smooths between samples, freezes at the end and rewinds on restart', () => {
    const playback = new GhostRacePlayback(ghost());
    expect(playback.sample(125).x).toBeCloseTo(12.5);
    expect(playback.sample(600).x).toBeCloseTo(60);
    expect(playback.sample(2000).x).toBe(100);
    expect(playback.sample(0).x).toBe(0);
    expect(playback.sample(125).x).toBeCloseTo(12.5);
  });
  it('never glides through respawns or room transitions', () => {
    const playback = new GhostRacePlayback(ghost({ points: [point(0, 0), point(500, 400, { snap: true }),
      point(750, 0, { roomX: 2, snap: true }), point(1000, 25, { roomX: 2 })] }));
    expect(playback.sample(499).x).toBe(0);
    expect(playback.sample(500).x).toBe(400);
    expect(playback.sample(749).roomX).toBe(1);
    expect(playback.sample(750)).toMatchObject({ roomX: 2, x: 0 });
    expect(playback.sample(875).x).toBeCloseTo(12.5);
  });
});
describe('verified guest personal bests', () => {
  const storage = () => { const values = new Map<string, string>(); return {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage; };
  it('keeps the fastest exact-version run and breaks equal times by deaths', () => {
    const s = storage();
    expect(saveLocalGhostBest(s, ghost(), 2)).toBe(true);
    expect(saveLocalGhostBest(s, ghost({ attemptId: 'slow', elapsedMs: 1200 }), 0)).toBe(false);
    expect(saveLocalGhostBest(s, ghost({ attemptId: 'clean' }), 0)).toBe(true);
    expect(loadLocalGhostBest(s, '1,2', 1)?.attemptId).toBe('clean');
    expect(loadLocalGhostBest(s, '1,2', 2)).toBeNull();
  });
  it('bounds retained rooms and tolerates unavailable storage', () => {
    const s = storage();
    for (let i = 0; i < 25; i++) saveLocalGhostBest(s, ghost({ roomId: String(i) }), 0);
    expect(loadLocalGhostBest(s, '0', 1)).toBeNull();
    expect(loadLocalGhostBest(s, '24', 1)).not.toBeNull();
    expect(saveLocalGhostBest(null, ghost(), 0)).toBe(false);
    expect(loadLocalGhostBest({ getItem: () => { throw Error('blocked'); } } as unknown as Storage, '1,2', 1)).toBeNull();
  });
});
