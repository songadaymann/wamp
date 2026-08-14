import type { RoomCoordinates } from '../persistence/roomModel';
import {
  getMultiplayerModeDefinition,
  type PvpHitSource,
  type PvpMatchCombatEvent,
  type PvpMatchConfigureMessage,
  type PvpMatchPlayerState,
  type PvpMatchSnapshot,
  type PvpMatchStatus,
  type PvpMode,
  type PvpParticipantIdentity,
  type PvpParticipantSnapshot,
  type PvpRoomStateEvent,
} from '../pvp/model';

export interface PvpMatchState {
  matchId: string;
  mode: PvpMode;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  status: PvpMatchStatus;
  participants: PvpParticipantSnapshot[];
  startedAt: number | null;
  countdownEndsAt: number | null;
  finishedAt: number | null;
  winnerUserId: string | null;
  loserUserId: string | null;
  draw: boolean;
  lastEvent: string | null;
  appliedHitIds: Set<string>;
  playerStatesByUserId: Map<string, PvpMatchPlayerState>;
}

export function createPvpMatchState(
  message: PvpMatchConfigureMessage,
  configuringParticipant: PvpParticipantIdentity,
): PvpMatchState | null {
  if (message.mode !== 'arena') return null;
  const mode = getMultiplayerModeDefinition(message.mode);
  const roomCoordinates = normalizeRoomCoordinates(message.roomCoordinates);
  const matchId = normalizeShortId(message.matchId, 96);
  const roomId = normalizeShortId(message.roomId, 80);
  if (!roomCoordinates || !matchId || !roomId) return null;

  const participants = normalizePvpParticipants(message.participants);
  if (!participants.some(({ userId }) => userId === configuringParticipant.userId)) {
    participants.push(configuringParticipant);
  }
  return {
    matchId,
    mode: mode.id,
    roomId,
    roomCoordinates,
    status: 'waiting',
    participants: participants.slice(0, mode.maxPlayers).map((participant) => ({
      ...participant,
      hearts: mode.startingLives,
      connected: false,
      invulnerableUntil: 0,
      losses: 0,
      hits: 0,
    })),
    startedAt: null,
    countdownEndsAt: null,
    finishedAt: null,
    winnerUserId: null,
    loserUserId: null,
    draw: false,
    lastEvent: mode.copy.createdEvent,
    appliedHitIds: new Set(),
    playerStatesByUserId: new Map(),
  };
}

export function isValidPvpMatchConfiguration(message: PvpMatchConfigureMessage): boolean {
  return (
    message.mode === 'arena' &&
    normalizeRoomCoordinates(message.roomCoordinates) !== null &&
    normalizeShortId(message.matchId, 96) !== null &&
    normalizeShortId(message.roomId, 80) !== null
  );
}

export function upsertPvpParticipant(
  match: PvpMatchState,
  identity: PvpParticipantIdentity,
): void {
  const existing = match.participants.find(({ userId }) => userId === identity.userId);
  if (existing) {
    existing.displayName = identity.displayName;
    existing.avatarId = identity.avatarId;
    existing.connected = true;
    return;
  }
  const mode = getMultiplayerModeDefinition(match.mode);
  if (match.participants.length >= mode.maxPlayers) return;
  match.participants.push({
    ...identity,
    hearts: mode.startingLives,
    connected: true,
    invulnerableUntil: 0,
    losses: 0,
    hits: 0,
  });
}

export function activatePvpMatchIfReady(match: PvpMatchState, now: number): boolean {
  if (match.status !== 'waiting') return false;
  const mode = getMultiplayerModeDefinition(match.mode);
  if (
    match.participants.length < mode.minPlayers ||
    match.participants.some(({ connected }) => !connected)
  ) {
    return false;
  }
  match.status = 'countdown';
  match.countdownEndsAt = now + mode.countdownMs;
  match.lastEvent = mode.copy.startRuleEvent;
  return true;
}

export function startPvpMatch(match: PvpMatchState, now: number): boolean {
  if (match.status !== 'countdown') return false;
  match.status = 'active';
  match.startedAt = now;
  match.countdownEndsAt = null;
  match.lastEvent = getMultiplayerModeDefinition(match.mode).copy.goEvent;
  return true;
}

export interface PvpLifeLossInput {
  hitId: string;
  targetUserId: string;
  attackerUserId: string | null;
  source: PvpHitSource;
}

export function applyPvpLifeLoss(
  match: PvpMatchState,
  input: PvpLifeLossInput,
  now: number,
): { changed: boolean; requiresFinalizeSchedule: boolean } {
  if (match.status !== 'active' && match.status !== 'finalizing') {
    return { changed: false, requiresFinalizeSchedule: false };
  }
  const hitId = normalizeShortId(input.hitId, 120);
  if (!hitId || match.appliedHitIds.has(hitId)) {
    return { changed: false, requiresFinalizeSchedule: false };
  }
  const target = match.participants.find(({ userId }) => userId === input.targetUserId);
  if (!target || target.hearts <= 0) return { changed: false, requiresFinalizeSchedule: false };
  if (
    input.attackerUserId &&
    !match.participants.some(({ userId }) => userId === input.attackerUserId)
  ) {
    return { changed: false, requiresFinalizeSchedule: false };
  }
  if (match.status === 'active' && now < target.invulnerableUntil) {
    return { changed: false, requiresFinalizeSchedule: false };
  }

  match.appliedHitIds.add(hitId);
  target.hearts = Math.max(0, target.hearts - 1);
  target.losses += 1;
  target.invulnerableUntil = now + getMultiplayerModeDefinition(match.mode).respawnInvulnerableMs;
  const attacker = input.attackerUserId
    ? match.participants.find(({ userId }) => userId === input.attackerUserId) ?? null
    : null;
  if (attacker && attacker.userId !== target.userId) attacker.hits += 1;
  match.lastEvent = input.source === 'environment'
    ? `${target.displayName} lost a heart.`
    : `${target.displayName} lost a heart to ${attacker?.displayName ?? 'opponent'}.`;
  const requiresFinalizeSchedule = target.hearts <= 0;
  if (requiresFinalizeSchedule) {
    match.status = 'finalizing';
    match.lastEvent = `${target.displayName} is out.`;
  }
  return { changed: true, requiresFinalizeSchedule };
}

export function markPvpForfeit(
  match: PvpMatchState,
  participant: PvpParticipantSnapshot,
  now: number,
): boolean {
  if (match.status === 'complete') return false;
  match.startedAt ??= now;
  match.countdownEndsAt = null;
  participant.hearts = 0;
  participant.losses = Math.max(
    participant.losses,
    getMultiplayerModeDefinition(match.mode).startingLives,
  );
  participant.invulnerableUntil = 0;
  match.status = 'finalizing';
  match.lastEvent = `${participant.displayName} forfeited.`;
  return true;
}

export function finalizePvpMatch(match: PvpMatchState, now: number): boolean {
  if (match.status === 'complete') return false;
  const eliminated = match.participants.filter(({ hearts }) => hearts <= 0);
  const alive = match.participants.filter(({ hearts }) => hearts > 0);
  match.status = 'complete';
  match.finishedAt = now;
  if (eliminated.length !== 1 || alive.length !== 1) {
    match.draw = true;
    match.winnerUserId = null;
    match.loserUserId = null;
    match.lastEvent = 'Draw.';
  } else {
    match.draw = false;
    match.winnerUserId = alive[0]?.userId ?? null;
    match.loserUserId = eliminated[0]?.userId ?? null;
    match.lastEvent = `${alive[0]?.displayName ?? 'Player'} wins.`;
  }
  return true;
}

export function getPvpSnapshot(match: PvpMatchState): PvpMatchSnapshot {
  return {
    matchId: match.matchId,
    mode: match.mode,
    roomId: match.roomId,
    roomCoordinates: { ...match.roomCoordinates },
    status: match.status,
    participants: match.participants.map((participant) => ({ ...participant })),
    startedAt: match.startedAt,
    countdownEndsAt: match.countdownEndsAt,
    finishedAt: match.finishedAt,
    winnerUserId: match.winnerUserId,
    loserUserId: match.loserUserId,
    draw: match.draw,
    lastEvent: match.lastEvent,
  };
}

export function normalizePvpPlayerState(
  value: unknown,
  userId: string,
  now: number,
): PvpMatchPlayerState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PvpMatchPlayerState>;
  const matchId = normalizeShortId(raw.matchId, 96);
  if (!matchId || !isPvpPlayerAnimationState(raw.animationState)) return null;
  const x = normalizeFiniteNumber(raw.x, -1_000_000, 1_000_000);
  const y = normalizeFiniteNumber(raw.y, -1_000_000, 1_000_000);
  const velocityX = normalizeFiniteNumber(raw.velocityX, -2_000, 2_000);
  const velocityY = normalizeFiniteNumber(raw.velocityY, -2_000, 2_000);
  const actionUntil = normalizeFiniteNumber(raw.actionUntil, 0, now + 10_000);
  const sequence = normalizeFiniteNumber(raw.sequence, 0, Number.MAX_SAFE_INTEGER);
  const sentAt = normalizeFiniteNumber(raw.sentAt, 0, now + 10_000);
  if ([x, y, velocityX, velocityY, actionUntil, sequence, sentAt].some((item) => item === null)) {
    return null;
  }
  return {
    matchId,
    userId,
    x: x!, y: y!, velocityX: velocityX!, velocityY: velocityY!,
    facing: raw.facing === -1 ? -1 : 1,
    animationState: raw.animationState,
    action: raw.action === 'sword' || raw.action === 'gun' ? raw.action : null,
    actionUntil: actionUntil!, sequence: Math.floor(sequence!), sentAt: sentAt!,
  };
}

export function normalizePvpCombatEvent(
  value: unknown,
  userId: string,
  now: number,
): PvpMatchCombatEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PvpMatchCombatEvent>;
  const id = normalizeShortId(raw.id, 120);
  const matchId = normalizeShortId(raw.matchId, 96);
  if (!id || !matchId || (raw.source !== 'sword' && raw.source !== 'gun')) return null;
  const x = normalizeFiniteNumber(raw.x, -1_000_000, 1_000_000);
  const y = normalizeFiniteNumber(raw.y, -1_000_000, 1_000_000);
  const startedAt = normalizeFiniteNumber(raw.startedAt, 0, now + 10_000);
  const durationMs = normalizeFiniteNumber(raw.durationMs, 16, 2_000);
  if (x === null || y === null || startedAt === null || durationMs === null) return null;
  return {
    id, matchId, userId, source: raw.source, x, y,
    facing: raw.facing === -1 ? -1 : 1,
    startedAt, durationMs,
    effectX: normalizeFiniteNumber(raw.effectX, -1_000_000, 1_000_000) ?? x,
    effectY: normalizeFiniteNumber(raw.effectY, -1_000_000, 1_000_000) ?? y,
    downward: raw.downward === true,
    projectile: normalizePvpProjectile(raw.projectile),
  };
}

export function normalizePvpRoomStateEvent(
  value: unknown,
  userId: string,
  now: number,
): PvpRoomStateEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PvpRoomStateEvent>;
  const id = normalizeShortId(raw.id, 120);
  const matchId = normalizeShortId(raw.matchId, 96);
  const roomId = normalizeShortId(raw.roomId, 80);
  const roomCoordinates = normalizeRoomCoordinates(raw.roomCoordinates);
  const sentAt = normalizeFiniteNumber(raw.sentAt, 0, now + 10_000);
  if (!id || !matchId || !roomId || !roomCoordinates || sentAt === null) return null;
  if (raw.kind === 'live-object-removed') {
    const objectKey = normalizeShortId(raw.objectKey, 160);
    const objectId = normalizeShortId(raw.objectId, 96);
    const instanceId = raw.instanceId === null ? null : normalizeShortId(raw.instanceId, 96);
    const x = normalizeFiniteNumber(raw.x, -1_000_000, 1_000_000);
    const y = normalizeFiniteNumber(raw.y, -1_000_000, 1_000_000);
    const reason = raw.reason === 'enemy-defeated' || raw.reason === 'collectible-collected' ||
      raw.reason === 'enemy-collected' || raw.reason === 'object-removed' ||
      raw.reason === 'brick-broken' ? raw.reason : null;
    if (!objectKey || !objectId || instanceId === undefined || x === null || y === null || !reason) return null;
    return { id, matchId, roomId, roomCoordinates, kind: 'live-object-removed', objectKey, objectId, instanceId, reason, x, y, sentAt, userId };
  }
  if (raw.kind === 'room-switch-state') {
    return { id, matchId, roomId, roomCoordinates, kind: 'room-switch-state', active: raw.active === true, sentAt, userId };
  }
  return null;
}

export function normalizePvpParticipants(value: unknown): PvpParticipantIdentity[] {
  if (!Array.isArray(value)) return [];
  const participants: PvpParticipantIdentity[] = [];
  const seenUserIds = new Set<string>();
  for (const item of value) {
    const participant = normalizePvpParticipant(item);
    if (!participant || seenUserIds.has(participant.userId)) continue;
    seenUserIds.add(participant.userId);
    participants.push(participant);
    if (participants.length >= 2) break;
  }
  return participants;
}

export function normalizePvpParticipant(value: unknown): PvpParticipantIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PvpParticipantIdentity>;
  const userId = normalizeShortId(raw.userId, 96);
  if (!userId) return null;
  return {
    userId,
    displayName: (typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName.trim() : 'Player').slice(0, 32),
    avatarId: (typeof raw.avatarId === 'string' && raw.avatarId.trim()
      ? raw.avatarId.trim() : 'default-player').slice(0, 32),
  };
}

export function normalizeRoomCoordinates(value: unknown): RoomCoordinates | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<RoomCoordinates>;
  return typeof raw.x === 'number' && typeof raw.y === 'number' &&
    Number.isInteger(raw.x) && Number.isInteger(raw.y)
    ? { x: raw.x, y: raw.y }
    : null;
}

export function normalizeShortId(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : null;
}

function normalizePvpProjectile(value: unknown): PvpMatchCombatEvent['projectile'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as NonNullable<PvpMatchCombatEvent['projectile']>;
  const x = normalizeFiniteNumber(raw.x, -1_000_000, 1_000_000);
  const y = normalizeFiniteNumber(raw.y, -1_000_000, 1_000_000);
  const velocityX = normalizeFiniteNumber(raw.velocityX, -2_000, 2_000);
  const lifetimeMs = normalizeFiniteNumber(raw.lifetimeMs, 16, 3_000);
  return x === null || y === null || velocityX === null || lifetimeMs === null
    ? null : { x, y, velocityX, lifetimeMs };
}

function normalizeFiniteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : null;
}

function isPvpPlayerAnimationState(value: unknown): value is PvpMatchPlayerState['animationState'] {
  return value === 'idle' || value === 'run' || value === 'jump-rise' ||
    value === 'jump-fall' || value === 'wall-slide' || value === 'wall-jump' ||
    value === 'land' || value === 'ladder-climb' || value === 'crouch' ||
    value === 'crawl' || value === 'push' || value === 'pull' ||
    value === 'sword-slash' || value === 'air-slash-down' || value === 'gun-fire';
}
