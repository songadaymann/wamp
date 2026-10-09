import { describe, expect, it } from 'vitest';
import {
  extractMusicPhrasePayloadFromPattern,
  materializeMusicPhraseTonalTrack,
  type MusicPhraseRecord,
} from './library';
import {
  createDefaultRoomPatternMusic,
  createDefaultRoomPhraseArrangementMusic,
  type RoomPatternInstrumentId,
} from './model';
import { DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX } from './pattern';
import { buildMusicPhraseAudition } from './phraseAudition';

function phrase(instrumentId: RoomPatternInstrumentId): MusicPhraseRecord {
  const source = createDefaultRoomPatternMusic();
  source.bpm = 84;
  source.swingPercent = 58;
  source.keyTonic = 'E';
  source.keyMode = 'minor';
  if (instrumentId === 'drums') {
    source.tabs.drums.snare = [0, 8, 16];
  } else {
    source.tabs[instrumentId].steps[0] = 3;
    source.tabs[instrumentId].steps[4] = 5;
  }
  const payload = extractMusicPhrasePayloadFromPattern(source, instrumentId);
  if (!payload) throw new Error('payload');
  return {
    id: `phrase-${instrumentId}`, batchId: 'batch', roomId: 'room', roomVersion: 1, roomTitle: null, roomX: 0, roomY: 0,
    creatorUserId: null, creatorPrincipalKind: null, creatorAgentId: null, creatorDisplayName: 'Builder',
    instrumentId, ordinal: 1, label: 'Phrase', fingerprint: `fp-${instrumentId}`, payload,
    sourceKeyTonic: payload.kind === 'tonal' ? 'E' : null, sourceKeyMode: payload.kind === 'tonal' ? 'minor' : null,
    sourcePhraseIds: [], createdAt: '2026-10-09T00:00:00.000Z',
  };
}

function room() {
  const pattern = createDefaultRoomPatternMusic();
  pattern.bpm = 132;
  pattern.swingPercent = 66;
  pattern.keyTonic = 'D';
  pattern.keyMode = 'minor';
  pattern.octaveShift.saw = -1;
  pattern.mix.saw.volume = 0;
  return pattern;
}

describe('library phrase audition', () => {
  it('renders the phrase alone exactly as Insert would place it into the room', () => {
    const saw = phrase('saw');
    const { sequence } = buildMusicPhraseAudition(saw, room(), { adoptPhraseTiming: false, adoptPhraseKey: false });

    expect(sequence).toMatchObject({ bpm: 132, swingPercent: 66, keyTonic: 'D', keyMode: 'minor', stepCount: 32, barCount: 2 });
    expect(sequence.tabs.saw).toEqual(materializeMusicPhraseTonalTrack(saw, 'scale', 'D', 'minor', -1));
    expect(sequence.tabs.triangle.steps.every((step) => step === null)).toBe(true);
    expect(sequence.tabs.square.steps.every((step) => step === null)).toBe(true);
    expect(Object.values(sequence.tabs.drums).every((hits) => hits.length === 0)).toBe(true);
    // A muted lane still auditions audibly.
    expect(sequence.mix).toEqual(DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX);
  });

  it('adopts the phrase tempo and key where placing into an empty room would', () => {
    const saw = phrase('saw');
    expect(buildMusicPhraseAudition(saw, room(), { adoptPhraseTiming: true, adoptPhraseKey: false }).sequence)
      .toMatchObject({ bpm: 84, swingPercent: 58, keyTonic: 'D', keyMode: 'minor' });
    expect(buildMusicPhraseAudition(saw, createDefaultRoomPhraseArrangementMusic(), { adoptPhraseTiming: true, adoptPhraseKey: true }).sequence)
      .toMatchObject({ bpm: 84, swingPercent: 58, keyTonic: 'E', keyMode: 'minor' });
  });

  it('auditions drum phrases on the drum lane', () => {
    const { sequence } = buildMusicPhraseAudition(phrase('drums'), room(), { adoptPhraseTiming: false, adoptPhraseKey: false });
    expect(sequence.tabs.drums.snare).toEqual([0, 8, 16]);
    expect(sequence.tabs.saw.steps.every((step) => step === null)).toBe(true);
  });

  it('keys the rendered audio by everything that changes how it sounds', () => {
    const saw = phrase('saw');
    const key = (context: ReturnType<typeof room>) =>
      buildMusicPhraseAudition(saw, context, { adoptPhraseTiming: false, adoptPhraseKey: false }).key;
    expect(key(room())).toBe(key(room()));
    expect(key({ ...room(), bpm: 120 })).not.toBe(key(room()));
    expect(key({ ...room(), keyTonic: 'G' })).not.toBe(key(room()));
    expect(key({ ...room(), octaveShift: { ...room().octaveShift, saw: 1 } })).not.toBe(key(room()));
    expect(key({ ...room(), octaveShift: { ...room().octaveShift, square: 1 } })).toBe(key(room()));
    const resaved = { ...saw, fingerprint: `${saw.fingerprint}-edited` };
    expect(buildMusicPhraseAudition(resaved, room(), { adoptPhraseTiming: false, adoptPhraseKey: false }).key).not.toBe(key(room()));
    expect(key(room()).length).toBeLessThan(80);
  });
});
