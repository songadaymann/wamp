import type { MusicPhraseRecord } from './library';
import {
  DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX,
  cloneRoomPatternInstrumentMix,
  normalizeRoomPatternBpm,
  normalizeRoomPatternSwingPercent,
  type RoomPatternPlaybackSequence,
} from './pattern';
import {
  buildPlaybackSequenceFromPhraseArrangement,
  createDefaultRoomPhraseArrangementMusic,
  type RoomPhraseArrangementMusic,
} from './phraseArrangement';

/** Room settings a phrase would be placed into: a sequencer pattern or a phrase arrangement. */
export type MusicPhraseAuditionContext = Pick<
  RoomPhraseArrangementMusic,
  'bpm' | 'swingPercent' | 'pitchMode' | 'keyTonic' | 'keyMode' | 'octaveShift'
>;

/**
 * Renders a library phrase on its own, exactly as placing it would sound.
 * `adoptPhraseTiming` and `adoptPhraseKey` mirror placement into an empty
 * sequencer (tempo and swing) or an empty arrangement (tempo, swing and key).
 * Uses the default mix so a muted or quiet lane still auditions audibly.
 */
export function buildMusicPhraseAudition(
  phrase: MusicPhraseRecord,
  context: MusicPhraseAuditionContext,
  options: { adoptPhraseTiming: boolean; adoptPhraseKey: boolean },
): { key: string; sequence: RoomPatternPlaybackSequence } {
  const arrangement = createDefaultRoomPhraseArrangementMusic();
  arrangement.bpm = normalizeRoomPatternBpm(options.adoptPhraseTiming ? phrase.payload.bpm : context.bpm);
  arrangement.swingPercent = normalizeRoomPatternSwingPercent(
    options.adoptPhraseTiming ? phrase.payload.swingPercent : context.swingPercent,
  );
  arrangement.pitchMode = context.pitchMode;
  arrangement.keyTonic = context.keyTonic;
  arrangement.keyMode = context.keyMode;
  if (options.adoptPhraseKey && phrase.payload.kind === 'tonal') {
    arrangement.keyTonic = phrase.sourceKeyTonic ?? phrase.payload.keyTonic;
    arrangement.keyMode = phrase.sourceKeyMode ?? phrase.payload.keyMode;
  }
  arrangement.octaveShift = { ...context.octaveShift };
  arrangement.mix = cloneRoomPatternInstrumentMix(DEFAULT_ROOM_PATTERN_INSTRUMENT_MIX);
  arrangement.slots[phrase.instrumentId][0] = phrase.id;

  const octaveShift = phrase.instrumentId === 'drums' ? 0 : arrangement.octaveShift[phrase.instrumentId];
  return {
    key: [
      phrase.id,
      hashFingerprint(phrase.fingerprint),
      arrangement.bpm,
      arrangement.swingPercent,
      arrangement.pitchMode,
      arrangement.keyTonic,
      arrangement.keyMode,
      octaveShift,
    ].join('|'),
    sequence: buildPlaybackSequenceFromPhraseArrangement(arrangement, new Map([[phrase.id, phrase]])),
  };
}

/** FNV-1a: a short id for a phrase's content, which changes when its owner re-saves it. */
function hashFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
