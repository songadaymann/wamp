import { describe, expect, it } from 'vitest';
import {
  isVisiblePresence,
  normalizePresencePayload,
  parseIncomingMessage,
  type PresencePayload,
} from './presenceProtocol';

function validPresence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roomCoordinates: { x: 1, y: -2 },
    x: 10,
    y: 20,
    velocityX: 0,
    velocityY: 0,
    facing: 1,
    animationState: 'idle',
    mode: 'play',
    timestamp: 123,
    ...overrides,
  };
}

describe('PartyKit presence protocol', () => {
  it('parses only JSON objects with a string message type without narrowing unknown types', () => {
    expect(parseIncomingMessage('{')).toBeNull();
    expect(parseIncomingMessage('null')).toBeNull();
    expect(parseIncomingMessage('[]')).toBeNull();
    expect(parseIncomingMessage(JSON.stringify({ type: 1 }))).toBeNull();
    expect(parseIncomingMessage(JSON.stringify({ type: 'unknown', acceptedQuirk: true }))).toEqual({
      type: 'unknown',
      acceptedQuirk: true,
    });
  });

  it('preserves accepted numeric quirks while requiring integer room coordinates', () => {
    expect(normalizePresencePayload(validPresence({ x: Number.NaN }))).toMatchObject({
      x: Number.NaN,
    });
    expect(normalizePresencePayload(validPresence({ velocityY: Number.POSITIVE_INFINITY }))).toMatchObject({
      velocityY: Number.POSITIVE_INFINITY,
    });
    expect(normalizePresencePayload(validPresence({ roomCoordinates: { x: 1.5, y: -2 } }))).toBeNull();
    expect(normalizePresencePayload(validPresence({ roomCoordinates: { x: 1, y: Number.NaN } }))).toBeNull();
  });

  it('requires every legacy presence field to be a number but does not add finite checks', () => {
    for (const field of ['x', 'y', 'velocityX', 'velocityY', 'facing', 'timestamp']) {
      expect(normalizePresencePayload(validPresence({ [field]: `${field}-string` }))).toBeNull();
    }
    expect(normalizePresencePayload(null)).toBeNull();
    expect(normalizePresencePayload([])).toBeNull();
  });

  it('accepts every existing animation and mode boundary and rejects unknown values', () => {
    const animations = [
      'idle',
      'run',
      'jump-rise',
      'jump-fall',
      'wall-slide',
      'wall-jump',
      'land',
      'ladder-climb',
      'crouch',
      'crawl',
      'push',
      'pull',
      'sword-slash',
      'air-slash-down',
      'gun-fire',
    ];

    for (const animationState of animations) {
      expect(normalizePresencePayload(validPresence({ animationState }))?.animationState).toBe(
        animationState,
      );
    }
    for (const mode of ['browse', 'play', 'edit']) {
      expect(normalizePresencePayload(validPresence({ mode }))?.mode).toBe(mode);
    }

    expect(normalizePresencePayload(validPresence({ animationState: 'butt-stomp-flip' }))).toBeNull();
    expect(normalizePresencePayload(validPresence({ mode: 'spectate' }))).toBeNull();
  });

  it('normalizes facing and the optional PvP presence state exactly at its boundaries', () => {
    expect(normalizePresencePayload(validPresence({ facing: -0.01 }))?.facing).toBe(-1);
    expect(normalizePresencePayload(validPresence({ facing: 0 }))?.facing).toBe(1);

    const longMatchId = `  ${'m'.repeat(100)}  `;
    expect(
      normalizePresencePayload(
        validPresence({
          pvp: { matchId: longMatchId, action: 'invalid', actionUntil: '42' },
        }),
      )?.pvp,
    ).toEqual({ matchId: 'm'.repeat(96), action: null, actionUntil: 42 });
    expect(
      normalizePresencePayload(
        validPresence({ pvp: { matchId: 'match', action: 'sword', actionUntil: Number.NaN } }),
      )?.pvp,
    ).toEqual({ matchId: 'match', action: 'sword', actionUntil: 0 });
    expect(normalizePresencePayload(validPresence({ pvp: { matchId: '   ' } }))?.pvp).toBeNull();
  });

  it('treats every normalized presence mode as visible and nullish values as hidden', () => {
    for (const mode of ['browse', 'play', 'edit'] as const) {
      const presence = normalizePresencePayload(validPresence({ mode })) as PresencePayload;
      expect(isVisiblePresence(presence)).toBe(true);
    }
    expect(isVisiblePresence(null)).toBe(false);
    expect(isVisiblePresence(undefined)).toBe(false);
  });
});
