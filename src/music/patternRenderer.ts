import { getPatternDrumSamples } from './patternKit';
import { ROOM_PATTERN_DRUM_ROWS, type RoomPatternInstrumentId, type RoomPatternPlaybackSequence } from './pattern';
import { getRoomPatternStemLanes, type PatternDrumSamples, type PatternRenderRequest } from './patternRenderCore';
import { renderPatternChannels } from './patternRenderClient';

export {
  ROOM_PATTERN_HAT_CHOKE_FADE_SEC,
  ROOM_PATTERN_LANE_DRIVE,
  ROOM_PATTERN_OUTPUT_DRIVE,
  getRoomPatternHatTiming,
  getRoomPatternLaneGain,
  getRoomPatternStemLanes,
} from './patternRenderCore';

const NO_DRUM_SAMPLES: PatternDrumSamples = new Map();

/** Renders off the main thread when it can (see patternRenderClient) and wraps the result in an AudioBuffer. */
async function renderToBuffer(
  audioContext: AudioContext,
  request: PatternRenderRequest,
  needsDrums: boolean,
): Promise<AudioBuffer> {
  const drumSamples = needsDrums ? await getPatternDrumSamples(audioContext) : NO_DRUM_SAMPLES;
  const channels = await renderPatternChannels(request, drumSamples);
  const buffer = audioContext.createBuffer(channels.length, channels[0].length, request.sampleRate);
  channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
  return buffer;
}

/** One lane of a single-slot sequence, unfolded through its tails (see renderLaneSegmentSamples). */
export async function renderRoomPatternLaneSegment(
  audioContext: AudioContext,
  pattern: RoomPatternPlaybackSequence,
  instrumentId: RoomPatternInstrumentId,
): Promise<AudioBuffer> {
  return renderToBuffer(
    audioContext,
    { kind: 'segment', pattern, instrumentId, sampleRate: audioContext.sampleRate },
    instrumentId === 'drums',
  );
}

/** The open hat voice at its mix level, for the scheduler to choke at the next slot's hat. */
export async function renderRoomPatternOpenHatVoice(audioContext: AudioContext): Promise<AudioBuffer | null> {
  const sample = (await getPatternDrumSamples(audioContext)).get('open-hat');
  const row = ROOM_PATTERN_DRUM_ROWS.find((candidate) => candidate.id === 'open-hat');
  if (!sample || !row || sample.length === 0) {
    return null;
  }
  const buffer = audioContext.createBuffer(1, sample.length, audioContext.sampleRate);
  buffer.getChannelData(0).set(sample.map((value) => value * row.defaultGain));
  return buffer;
}

/**
 * Renders each sounding lane as its own channel (see getRoomPatternStemLanes) so
 * playback can mix volume and pan live. Mixing channel c of lane i with
 * getRoomPatternLaneGain, an equal-power pan and tanh(sum * ROOM_PATTERN_OUTPUT_DRIVE)
 * reproduces renderRoomPatternLoopBuffer.
 */
export async function renderRoomPatternStemBuffer(
  audioContext: AudioContext,
  pattern: RoomPatternPlaybackSequence,
): Promise<AudioBuffer> {
  return renderToBuffer(
    audioContext,
    { kind: 'stems', pattern, sampleRate: audioContext.sampleRate },
    getRoomPatternStemLanes(pattern).includes('drums'),
  );
}

export async function renderRoomPatternLoopBuffer(
  audioContext: AudioContext,
  pattern: RoomPatternPlaybackSequence,
): Promise<AudioBuffer> {
  return renderToBuffer(audioContext, { kind: 'loop', pattern, sampleRate: audioContext.sampleRate }, true);
}
