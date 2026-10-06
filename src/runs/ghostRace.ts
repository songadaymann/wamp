import type { RoomGoal } from '../goals/roomGoals';
import { getLeaderboardRankingMode } from './scoring';
import type { RankedRunVerificationTrace } from './verificationTrace';

export const MAX_GHOST_POINTS = 2304;
export const MAX_GHOST_BYTES = 300_000;
export type GhostRaceChoice = 'off' | 'top' | 'personal';
export interface GhostPoint {
  atMs: number; roomX: number; roomY: number; x: number; y: number;
  vx: number; vy: number; grounded: boolean; snap: boolean;
}
export interface RunGhost {
  schemaVersion: 1; attemptId: string; roomId: string; roomVersion: number;
  displayName: string; avatarId: string; elapsedMs: number; points: GhostPoint[];
}
export type GhostUnavailable = 'no_run' | 'no_recording' | 'layout_changed' | 'sign_in' | 'unsupported';
export interface GhostOption { ghost: RunGhost | null; reason: GhostUnavailable | null }
export interface RoomGhostResponse {
  roomId: string; roomVersion: number; top: GhostOption; personal: GhostOption;
}
export function supportsGhostRace(goal: RoomGoal | null): boolean {
  return goal !== null && getLeaderboardRankingMode(goal) === 'time';
}

/** Whitelist movement only. Verification credentials, inputs and analytics never leave this boundary. */
export function buildRunGhost(
  metadata: Omit<RunGhost, 'schemaVersion' | 'points'>,
  trace: RankedRunVerificationTrace,
): RunGhost | null {
  if (trace.breadcrumbs.length < 2 || trace.breadcrumbs.length > 2048
    || trace.roomTransitions.length > 256 || (trace.respawnEvents?.length ?? 0) > 256) return null;
  const respawns = new Set(trace.respawnEvents?.map(event => event.breadcrumbIndex) ?? []);
  const points: GhostPoint[] = trace.breadcrumbs.map((point, index) => ({
    atMs: point.atMs, roomX: point.roomX, roomY: point.roomY, x: point.x, y: point.y,
    vx: point.vx, vy: point.vy, grounded: point.grounded,
    snap: respawns.has(index) || (index > 0 && unexplainedJump(trace.breadcrumbs[index - 1], point)),
  }));
  for (const event of trace.roomTransitions) points.push({
    atMs: event.atMs, roomX: event.toRoomX, roomY: event.toRoomY, x: event.x, y: event.y,
    vx: 0, vy: 0, grounded: false, snap: true,
  });
  const finish = [...trace.goalEvents].reverse().find(event => event.type === 'complete' && event.actor === 'player');
  if (finish) points.push({
    atMs: Math.min(metadata.elapsedMs, finish.atMs), roomX: finish.roomX, roomY: finish.roomY,
    x: finish.x, y: finish.y, vx: 0, vy: 0, grounded: true, snap: false,
  });
  points.sort((a, b) => a.atMs - b.atMs);
  for (let i = 1; i < points.length; i++) {
    if (points[i].roomX !== points[i - 1].roomX || points[i].roomY !== points[i - 1].roomY) points[i].snap = true;
  }
  return normalizeRunGhost({ ...metadata, schemaVersion: 1, points });
}

function unexplainedJump(a: RankedRunVerificationTrace['breadcrumbs'][number],
  b: RankedRunVerificationTrace['breadcrumbs'][number]): boolean {
  if (a.roomX !== b.roomX || a.roomY !== b.roomY) return false;
  const travel = Math.max(Math.hypot(a.vx, a.vy), Math.hypot(b.vx, b.vy)) * Math.max(0, b.atMs - a.atMs) / 1000;
  return Math.hypot(b.x - a.x, b.y - a.y) > 32 + travel;
}

export function normalizeRunGhost(value: unknown): RunGhost | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as RunGhost;
  if (g.schemaVersion !== 1 || typeof g.attemptId !== 'string' || g.attemptId.length > 100
    || typeof g.roomId !== 'string' || g.roomId.length > 100
    || !Number.isSafeInteger(g.roomVersion) || g.roomVersion < 1
    || typeof g.displayName !== 'string' || g.displayName.length > 100
    || typeof g.avatarId !== 'string' || g.avatarId.length > 100
    || !Number.isFinite(g.elapsedMs) || g.elapsedMs <= 0 || g.elapsedMs > 30 * 60_000
    || !Array.isArray(g.points) || g.points.length < 2 || g.points.length > MAX_GHOST_POINTS) return null;
  let previous = -1;
  const points: GhostPoint[] = [];
  for (const p of g.points) {
    if (!p || !Number.isSafeInteger(p.atMs) || p.atMs < previous || p.atMs < 0 || p.atMs > g.elapsedMs + 2000
      || !Number.isSafeInteger(p.roomX) || !Number.isSafeInteger(p.roomY)
      || Math.abs(p.roomX) > 100_000 || Math.abs(p.roomY) > 100_000
      || ![p.x, p.y, p.vx, p.vy].every(n => Number.isFinite(n) && Math.abs(n) < 8192)
      || typeof p.grounded !== 'boolean' || typeof p.snap !== 'boolean') return null;
    points.push({ atMs: p.atMs, roomX: p.roomX, roomY: p.roomY,
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, snap: p.snap });
    previous = p.atMs;
  }
  if (points[0].atMs > 1000) return null;
  const ghost: RunGhost = { schemaVersion: 1, attemptId: g.attemptId, roomId: g.roomId,
    roomVersion: g.roomVersion, displayName: g.displayName, avatarId: g.avatarId, elapsedMs: g.elapsedMs, points };
  return JSON.stringify(ghost).length <= MAX_GHOST_BYTES ? ghost : null;
}

/** A cursor costs constant work during normal forward playback; seeking/restart resets it. */
export class GhostRacePlayback {
  private index = 0;
  private lastAt = -1;
  constructor(readonly ghost: RunGhost) {}
  sample(atMs: number): GhostPoint {
    if (atMs < this.lastAt) this.index = 0;
    this.lastAt = atMs;
    const points = this.ghost.points;
    while (this.index + 1 < points.length && points[this.index + 1].atMs <= atMs) this.index++;
    const a = points[this.index], b = points[this.index + 1];
    if (!b || atMs <= a.atMs || b.snap || a.roomX !== b.roomX || a.roomY !== b.roomY
      || b.atMs - a.atMs > 1000) return a;
    const duration = b.atMs - a.atMs;
    const t = Math.max(0, Math.min(1, (atMs - a.atMs) / duration));
    const smooth = (p0: number, p1: number, v0: number, v1: number) => {
      const t2 = t * t, t3 = t2 * t, seconds = duration / 1000;
      const value = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * seconds * v0
        + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * seconds * v1;
      return Math.max(Math.min(p0, p1) - 16, Math.min(Math.max(p0, p1) + 16, value));
    };
    return { ...a, atMs, x: smooth(a.x, b.x, a.vx, b.vx), y: smooth(a.y, b.y, a.vy, b.vy),
      vx: a.vx + (b.vx - a.vx) * t, vy: a.vy + (b.vy - a.vy) * t };
  }
}
