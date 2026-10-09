import { getMusicTransitionPlan, type MusicTransitionMode } from './transitionPlan';
import { RoomMusicBufferCache } from './bufferCache';
import {
  getRoomMusicClip,
  getRoomMusicLane,
  getRoomMusicPack,
} from './catalog';
import {
  ROOM_MUSIC_LANE_IDS,
  cloneRoomMusic,
  getRoomMusicBarDurationSec,
  getRoomMusicContentKey,
  getRoomMusicKey,
  getRoomMusicLoopDurationSec,
  isPatternRoomMusic,
  isPhraseArrangementRoomMusic,
  isRoomMusicEmpty,
  type RoomMusic,
  type RoomMusicBarClipId,
  type RoomMusicLaneBarAssignments,
  type RoomMusicLaneId,
  type RoomPhraseArrangementMusic,
  type StemArrangementRoomMusic,
} from './model';
import { loadMusicPhrasesById } from './libraryClient';
import {
  ROOM_PATTERN_LANE_DRIVE,
  ROOM_PATTERN_OUTPUT_DRIVE,
  getRoomPatternHatTiming,
  getRoomPatternLaneGain,
  getRoomPatternStemLanes,
  renderRoomPatternLaneSegment,
  renderRoomPatternLoopBuffer,
  renderRoomPatternOpenHatVoice,
  renderRoomPatternStemBuffer,
} from './patternRenderer';
import {
  collectRoomPhraseArrangementPhraseIds,
  getRoomPhraseArrangementActiveSlotCount,
} from './phraseArrangement';
import { buildMusicPhraseAudition } from './phraseAudition';
import {
  PhraseArrangementScheduler,
  type ArrangementLaneSegment,
  type ArrangementTimeline,
} from './phraseArrangementPlayback';
import type { MusicPhraseRecord } from './library';
import { getPatternDrumSamples } from './patternKit';
import {
  ROOM_PATTERN_INSTRUMENT_IDS,
  getPatternDrumRowForGridRow,
  getPatternRowNote,
  type RoomPatternDrumRowId,
  type RoomPatternInstrumentId,
  type RoomPatternInstrumentMix,
  type RoomPatternMusic,
  type RoomPatternPlaybackSequence,
  type RoomPatternTonalInstrumentId,
} from './pattern';

type TransitionMode = MusicTransitionMode;
export type RoomMusicPlayheadInfo = {
  audioCurrentTime: number | null;
  transportStartTime: number;
  patternStartTime: number | null;
  loopDurationSec: number | null;
  kind: RoomMusic['kind'] | null;
  swingPercent: number | null;
  /** Active Arrange slots in the playing phrase loop; null for other music. */
  segmentCount: number | null;
  outputLatencySec: number;
};
type PlaybackMode = 'idle' | 'editor-preview' | 'world-play';

/** Live per-lane mixer: optional lane drive, lane gain and pan, then the shared soft clip. */
type StemMix = {
  lanes: Map<RoomPatternInstrumentId, { gain: GainNode; panner: StereoPannerNode | null; scale: number }>;
  /** Where each lane's audio enters the mixer. */
  inputs: Map<RoomPatternInstrumentId, AudioNode>;
  nodes: AudioNode[];
};

type ActiveLoopPlayback = {
  playbackId: string;
  /** A looping buffer, or for Arrange a scheduler playing per-slot segments. */
  source: AudioBufferSourceNode | null;
  scheduler: PhraseArrangementScheduler | null;
  /** Arrange segments by render key, reused when an edit keeps them. */
  segments: Map<string, ArrangementLaneSegment> | null;
  gain: GainNode;
  stemMix: StemMix | null;
  startTime: number;
  stopTime: number | null;
  baseGain: number;
  loopDurationSec: number;
  fadeInDuration: number;
  fadeOut: { start: number; end: number; startGain: number } | null;
};

type PreviewClipPlayback = {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
};

const MAX_PLAYHEAD_OUTPUT_LATENCY_SEC = 0.5;
// The stem bus is scaled into the WaveShaper's [-1, 1] input range; sums up to
// this level map exactly onto tanh(sum * ROOM_PATTERN_OUTPUT_DRIVE).
const STEM_BUS_HEADROOM = 4;
const STEM_CURVE_POINTS = 16385;
const STEM_MIX_TIME_CONSTANT_SEC = 0.015;
// Raw Arrange lanes can sum past 1 before their drive; scale them into the curve's range.
const LANE_DRIVE_HEADROOM = 8;

type OneShotPlayback = {
  stop: () => void;
};

type AudioResumeDebugEntry = {
  at: number;
  trigger: string;
  status: 'no-context' | 'already-running' | 'resumed' | 'failed';
  stateBefore: string | null;
  stateAfter: string | null;
  errorName?: string;
  errorMessage?: string;
};

type AudioContextStateDebugEntry = {
  at: number;
  state: string;
};

type PlaybackRequestStatus =
  | 'pending'
  | 'already-playing'
  | 'started'
  | 'stopped'
  | 'stale'
  | 'empty'
  | 'muted'
  | 'error';

type PlaybackRequestDebugEntry = {
  at: number;
  id: number;
  mode: PlaybackMode;
  arrangementKey: string | null;
  status: PlaybackRequestStatus;
  errorName?: string;
  errorMessage?: string;
};

const IMMEDIATE_FADE_DURATION_SEC = 0.12;
const GLOBAL_MUSIC_VOLUME_MULTIPLIER = 0.6;

function resolveAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedPath = path.replace(/^\/+/, '');
  const baseUrl = new URL(base, window.location.href);
  return new URL(normalizedPath, baseUrl).toString();
}

export class RoomMusicController {
  private initialized = false;
  private userInteracted = false;
  private lifecycleDocument: Pick<Document, 'hidden'> | null = null;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 1;
  private transportStartTime = 0;
  private activeLanes = new Map<RoomMusicLaneId, ActiveLoopPlayback>();
  private activePattern: ActiveLoopPlayback | null = null;
  private readonly retiringPlaybacks = new Set<ActiveLoopPlayback>();
  private previewClipPlayback: PreviewClipPlayback | null = null;
  private previewClipRequestSerial = 0;
  private oneShotRequestSerial = 0;
  private readonly oneShotPlaybacks = new Set<OneShotPlayback>();
  private readonly bufferCache = new RoomMusicBufferCache();
  private readonly stemLanes = new WeakMap<AudioBuffer, RoomPatternInstrumentId[]>();
  private stemOutputCurve: Float32Array<ArrayBuffer> | null = null;
  private readonly laneDriveCurves = new Map<RoomPatternInstrumentId, Float32Array<ArrayBuffer>>();
  private openHatVoice: Promise<AudioBuffer | null> | null = null;
  private currentArrangement: RoomMusic | null = null;
  private desiredPlayback: {
    music: RoomMusic;
    options: { mode: PlaybackMode; transition?: TransitionMode; fadeDurationSec?: number };
  } | null = null;
  private mode: PlaybackMode = 'idle';
  private playbackRequestSerial = 0;
  private lastPlaybackRequest: PlaybackRequestDebugEntry | null = null;
  private lastStalePlaybackRequest: PlaybackRequestDebugEntry | null = null;
  private lastResumeAttempt: AudioResumeDebugEntry | null = null;
  private lastAudioContextStateChange: AudioContextStateDebugEntry | null = null;

  init(windowObj: Window = window): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.lifecycleDocument = windowObj.document;
    const markInteracted = () => {
      this.userInteracted = true;
      void this.resumeAudioContext('user-gesture');
    };

    const resumeAfterLifecycleEvent = (trigger: string) => {
      if (!this.userInteracted) {
        return;
      }
      void this.resumeAudioContext(trigger);
    };

    windowObj.addEventListener('pointerdown', markInteracted, { passive: true });
    windowObj.addEventListener('keydown', markInteracted, { passive: true });
    windowObj.addEventListener('touchstart', markInteracted, { passive: true });
    windowObj.addEventListener('focus', () => resumeAfterLifecycleEvent('window-focus'), { passive: true });
    windowObj.addEventListener('pageshow', () => resumeAfterLifecycleEvent('pageshow'), { passive: true });
    windowObj.document.addEventListener('visibilitychange', () => {
      if (windowObj.document.hidden) {
        this.suspendAudioContext();
      } else {
        resumeAfterLifecycleEvent('visibilitychange-visible');
      }
    });
  }

  async playArrangement(
    music: RoomMusic | null,
    options: {
      mode: PlaybackMode;
      transition?: TransitionMode;
      fadeDurationSec?: number;
    },
  ): Promise<void> {
    this.init();
    const requestId = this.beginPlaybackRequest(options.mode, getRoomMusicKey(music));
    this.mode = options.mode;

    if (!music || isRoomMusicEmpty(music)) {
      this.recordPlaybackRequestStatus(requestId, options.mode, getRoomMusicKey(music), 'empty');
      this.stopArrangement({
        transition: options.transition ?? 'bar',
        mode: options.mode,
        fadeDurationSec: options.fadeDurationSec,
      });
      return;
    }

    const nextArrangement = cloneRoomMusic(music);
    if (!nextArrangement) {
      this.recordPlaybackRequestStatus(requestId, options.mode, getRoomMusicKey(music), 'empty');
      this.stopArrangement({
        transition: options.transition ?? 'bar',
        mode: options.mode,
        fadeDurationSec: options.fadeDurationSec,
      });
      return;
    }

    this.desiredPlayback = { music: nextArrangement, options: { ...options } };
    if (this.volume === 0) {
      const desired = this.desiredPlayback;
      this.stopArrangement({ transition: 'immediate', mode: options.mode, fadeDurationSec: 0.08 });
      this.desiredPlayback = desired;
      this.recordPlaybackRequestStatus(this.playbackRequestSerial, options.mode, getRoomMusicKey(nextArrangement), 'muted');
      return;
    }

    try {
      if (isPatternRoomMusic(nextArrangement)) {
        await this.playPatternArrangement(nextArrangement, options, requestId);
        return;
      }

      if (isPhraseArrangementRoomMusic(nextArrangement)) {
        await this.playPhraseArrangement(nextArrangement, options, requestId);
        return;
      }

      await this.playStemArrangement(nextArrangement, options, requestId);
    } catch (error) {
      this.recordPlaybackRequestStatus(
        requestId,
        options.mode,
        getRoomMusicKey(nextArrangement),
        'error',
        error,
      );
    }
  }

  stopArrangement(options?: {
    transition?: TransitionMode;
    mode?: PlaybackMode;
    fadeDurationSec?: number;
    resetTransport?: boolean;
  }): void {
    this.desiredPlayback = null;
    const requestId = this.invalidatePlaybackRequests();
    const nextMode = options?.mode ?? 'idle';
    this.recordPlaybackRequestStatus(requestId, nextMode, null, 'stopped');
    const audioContext = this.audioContext;
    if (!audioContext) {
      this.activeLanes.clear();
      this.activePattern = null;
      this.currentArrangement = null;
      this.mode = nextMode;
      if (options?.resetTransport) {
        this.transportStartTime = 0;
      }
      return;
    }

    const now = audioContext.currentTime;
    const transition = options?.transition ?? 'bar';
    const activeBarDuration = getRoomMusicBarDurationSec(this.currentArrangement);
    const quantizeToBar = transition === 'bar' && this.hasActivePlaybacks() && activeBarDuration > 0;
    const stopAt = quantizeToBar ? this.getNextBarBoundary(activeBarDuration, now) : now;
    const fadeDuration =
      options?.fadeDurationSec
      ?? (quantizeToBar ? activeBarDuration : IMMEDIATE_FADE_DURATION_SEC);

    for (const playback of [...this.retiringPlaybacks]) {
      this.scheduleStopPlayback(playback, { stopAt: now, fadeDuration: options?.fadeDurationSec ?? IMMEDIATE_FADE_DURATION_SEC });
    }
    for (const playback of this.activeLanes.values()) {
      this.scheduleStopPlayback(playback, { stopAt, fadeDuration });
    }
    this.activeLanes.clear();

    if (this.activePattern) {
      this.scheduleStopPlayback(this.activePattern, { stopAt, fadeDuration });
      this.activePattern = null;
    }

    this.currentArrangement = null;
    this.mode = nextMode;
    if (options?.resetTransport) {
      this.transportStartTime = 0;
    }
  }

  async previewClip(packId: string, clipId: string): Promise<void> {
    this.init();
    if (this.volume === 0) return;
    const requestId = ++this.previewClipRequestSerial;
    const pack = getRoomMusicPack(packId);
    const clip = pack ? getRoomMusicClip(pack, clipId) : null;
    if (!pack || !clip) {
      this.stopPreviewClip();
      return;
    }

    const buffer = await this.loadBuffer(packId, clipId);
    if (this.volume === 0 || requestId !== this.previewClipRequestSerial) return;
    const audioContext = this.getAudioContext();
    const masterGain = this.ensureMasterGain(audioContext);
    if (!audioContext || !masterGain) {
      return;
    }

    this.stopPreviewClip();
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.92, audioContext.currentTime);
    gain.connect(masterGain);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = Math.min(pack.loopDurationSec, buffer.duration);
    source.connect(gain);
    source.start(audioContext.currentTime + 0.02, 0);

    this.previewClipPlayback = {
      clipId,
      source,
      gain,
    };
    void this.resumeAudioContext('preview-clip');
  }

  /**
   * Loops a rendered sequence (a library phrase audition) through the preview
   * voice without touching room playback. Resolves false when it was superseded.
   */
  async previewSequence(previewId: string, sequence: RoomPatternPlaybackSequence): Promise<boolean> {
    this.init();
    if (this.volume === 0) return false;
    const requestId = ++this.previewClipRequestSerial;
    const audioContext = this.getAudioContext();
    const masterGain = this.ensureMasterGain(audioContext);
    if (!audioContext || !masterGain) {
      return false;
    }

    const cacheKey = `audition:${previewId}`;
    let bufferPromise = this.bufferCache.get(cacheKey);
    if (!bufferPromise) {
      bufferPromise = renderRoomPatternLoopBuffer(audioContext, sequence);
      this.bufferCache.set(cacheKey, 'clip', bufferPromise);
    }
    const buffer = await bufferPromise;
    if (this.volume === 0 || requestId !== this.previewClipRequestSerial) return false;

    this.stopPreviewClip();
    const gain = audioContext.createGain();
    const startAt = audioContext.currentTime + 0.02;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.92, startAt + 0.01);
    gain.connect(masterGain);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    source.connect(gain);
    source.start(startAt, 0);

    this.previewClipPlayback = {
      clipId: previewId,
      source,
      gain,
    };
    void this.resumeAudioContext('preview-sequence');
    return true;
  }

  stopPreviewClip(): void {
    this.previewClipRequestSerial += 1;
    if (!this.previewClipPlayback) {
      return;
    }

    try {
      this.previewClipPlayback.source.stop();
    } catch {
      void 0;
    }
    try {
      this.previewClipPlayback.source.disconnect();
    } catch {
      void 0;
    }
    try {
      this.previewClipPlayback.gain.disconnect();
    } catch {
      void 0;
    }
    this.previewClipPlayback = null;
  }

  setVolume(value: number): void {
    const nextVolume = clampUnit(Number.isFinite(value) ? value : 1);
    if (this.volume === nextVolume) {
      return;
    }

    const wasMuted = this.volume === 0;
    this.volume = nextVolume;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setTargetAtTime(
        this.getMasterGainValue(),
        this.audioContext.currentTime,
        0.02,
      );
    }
    if (nextVolume === 0) {
      const desired = this.desiredPlayback;
      this.stopArrangement({ transition: 'immediate', mode: this.mode, fadeDurationSec: 0.08 });
      this.desiredPlayback = desired;
      this.stopPreviewClip();
      this.oneShotRequestSerial += 1;
      for (const playback of this.oneShotPlaybacks) playback.stop();
    } else if (wasMuted && this.desiredPlayback) {
      const desired = this.desiredPlayback;
      void this.playArrangement(desired.music, desired.options);
    }
  }

  previewPatternCell(
    pattern: RoomPatternMusic,
    instrumentId: RoomPatternInstrumentId,
    row: number,
  ): void {
    this.init();
    if (this.volume === 0) return;
    const audioContext = this.getAudioContext();
    const masterGain = this.ensureMasterGain(audioContext);
    if (!audioContext || !masterGain) {
      return;
    }

    if (instrumentId === 'drums') {
      const drumRow = getPatternDrumRowForGridRow(row);
      if (!drumRow) {
        return;
      }

      void this.previewDrumPatternCell(
        audioContext,
        masterGain,
        pattern,
        drumRow.id,
        drumRow.defaultGain,
      );
      return;
    }

    const note = getPatternRowNote(
      instrumentId as RoomPatternTonalInstrumentId,
      row,
      pattern.pitchMode,
      pattern.octaveShift[instrumentId as RoomPatternTonalInstrumentId],
      pattern.keyTonic,
      pattern.keyMode,
    );
    if (!note) {
      return;
    }

    const waveform =
      instrumentId === 'triangle'
        ? 'triangle'
        : instrumentId === 'saw'
          ? 'sawtooth'
          : 'square';
    const now = audioContext.currentTime + 0.005;
    const osc = audioContext.createOscillator();
    osc.type = waveform;
    osc.frequency.setValueAtTime(note.frequencyHz, now);

    const gain = audioContext.createGain();
    const mix = pattern.mix[instrumentId as RoomPatternTonalInstrumentId];
    const previewGain =
      instrumentId === 'triangle'
        ? 0.18
        : instrumentId === 'saw'
          ? 0.14
          : 0.12;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(Math.max(0.02, mix.volume * previewGain), now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    let outputNode: AudioNode = gain;
    if (typeof audioContext.createStereoPanner === 'function') {
      const panner = audioContext.createStereoPanner();
      panner.pan.setValueAtTime(mix.pan, now);
      gain.connect(panner);
      panner.connect(masterGain);
      outputNode = panner;
    } else {
      gain.connect(masterGain);
    }

    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.2);

    const oneShot: OneShotPlayback = {
      stop: () => {
        try {
          osc.stop();
        } catch {
          void 0;
        }
      },
    };
    this.oneShotPlaybacks.add(oneShot);
    osc.addEventListener(
      'ended',
      () => {
        this.oneShotPlaybacks.delete(oneShot);
        try {
          osc.disconnect();
        } catch {
          void 0;
        }
        try {
          gain.disconnect();
        } catch {
          void 0;
        }
        if (outputNode !== gain) {
          try {
            outputNode.disconnect();
          } catch {
            void 0;
          }
        }
      },
      { once: true },
    );
    void this.resumeAudioContext('preview-pattern-cell');
  }

  private async previewDrumPatternCell(
    audioContext: AudioContext,
    masterGain: GainNode,
    pattern: RoomPatternMusic,
    rowId: RoomPatternDrumRowId,
    defaultGain: number,
  ): Promise<void> {
    const requestId = this.oneShotRequestSerial;
    const sample = (await getPatternDrumSamples(audioContext)).get(rowId);
    if (!sample || this.volume === 0 || requestId !== this.oneShotRequestSerial) {
      return;
    }

    const buffer = audioContext.createBuffer(1, sample.length, audioContext.sampleRate);
    buffer.getChannelData(0).set(sample);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    const gain = audioContext.createGain();
    const mix = pattern.mix.drums;
    gain.gain.setValueAtTime(Math.max(0.04, mix.volume * defaultGain * 0.52), audioContext.currentTime);

    source.connect(gain);
    gain.connect(masterGain);
    source.start(audioContext.currentTime + 0.005);

    const oneShot: OneShotPlayback = {
      stop: () => {
        try {
          source.stop();
        } catch {
          void 0;
        }
      },
    };
    this.oneShotPlaybacks.add(oneShot);
    source.addEventListener(
      'ended',
      () => {
        this.oneShotPlaybacks.delete(oneShot);
        try {
          source.disconnect();
        } catch {
          void 0;
        }
        try {
          gain.disconnect();
        } catch {
          void 0;
        }
      },
      { once: true },
    );
    void this.resumeAudioContext('preview-drum-cell');
  }

  getPlayheadInfo(): RoomMusicPlayheadInfo {
    const arrangement = this.currentArrangement;
    const loopDurationSec = this.activePattern?.loopDurationSec ?? null;
    const outputLatency = this.audioContext?.outputLatency;
    // Per-frame read: derive the slot count from scalars rather than walking slots.
    const segmentDurationSec = isPhraseArrangementRoomMusic(arrangement)
      ? getRoomMusicBarDurationSec(arrangement) * arrangement.segmentBarCount
      : 0;
    return {
      audioCurrentTime: this.audioContext?.currentTime ?? null,
      transportStartTime: this.transportStartTime,
      patternStartTime: this.activePattern?.startTime ?? null,
      loopDurationSec,
      kind: arrangement?.kind ?? null,
      swingPercent: arrangement && arrangement.kind !== 'stemArrangement' ? arrangement.swingPercent : null,
      segmentCount: segmentDurationSec > 0 && loopDurationSec !== null
        ? Math.max(1, Math.round(loopDurationSec / segmentDurationSec))
        : null,
      outputLatencySec: typeof outputLatency === 'number' && Number.isFinite(outputLatency)
        ? Math.max(0, Math.min(MAX_PLAYHEAD_OUTPUT_LATENCY_SEC, outputLatency))
        : 0,
    };
  }

  getPreviewClipId(): string | null {
    return this.previewClipPlayback?.clipId ?? null;
  }

  getDebugState(): Record<string, unknown> {
    const currentTime = this.audioContext?.currentTime ?? 0;
    return {
      initialized: this.initialized,
      bufferCache: this.bufferCache.getDebugSnapshot(),
      retiringLoopCount: this.retiringPlaybacks.size,
      userInteracted: this.userInteracted,
      mode: this.mode,
      volume: this.volume,
      audioContextState: this.audioContext?.state ?? null,
      lastAudioContextStateChange: this.lastAudioContextStateChange,
      lastResumeAttempt: this.lastResumeAttempt,
      lastPlaybackRequest: this.lastPlaybackRequest,
      lastStalePlaybackRequest: this.lastStalePlaybackRequest,
      transportStartTime: this.transportStartTime,
      audioCurrentTime: Number(currentTime.toFixed(3)),
      oneShotCount: this.oneShotPlaybacks.size,
      activeLanes: Array.from(this.activeLanes.entries()).map(([laneId, playback]) => ({
        laneId,
        playbackId: playback.playbackId,
        startTime: Number(playback.startTime.toFixed(3)),
        stopTime: playback.stopTime === null ? null : Number(playback.stopTime.toFixed(3)),
        fadeInDuration: Number(playback.fadeInDuration.toFixed(3)),
        baseGain: Number(playback.baseGain.toFixed(3)),
      })),
      activePattern: this.activePattern
        ? {
            playbackId: this.activePattern.playbackId,
            startTime: Number(this.activePattern.startTime.toFixed(3)),
            stopTime: this.activePattern.stopTime === null ? null : Number(this.activePattern.stopTime.toFixed(3)),
            fadeInDuration: Number(this.activePattern.fadeInDuration.toFixed(3)),
            baseGain: Number(this.activePattern.baseGain.toFixed(3)),
            loopDurationSec: Number(this.activePattern.loopDurationSec.toFixed(3)),
          }
        : null,
      currentArrangement: cloneRoomMusic(this.currentArrangement),
      currentArrangementKey: getRoomMusicKey(this.currentArrangement),
      previewClipId: this.previewClipPlayback?.clipId ?? null,
    };
  }

  private async playStemArrangement(
    nextArrangement: StemArrangementRoomMusic,
    options: {
      mode: PlaybackMode;
      transition?: TransitionMode;
      fadeDurationSec?: number;
    },
    requestId: number,
  ): Promise<void> {
    const pack = getRoomMusicPack(nextArrangement.packId);
    if (!pack) {
      this.stopArrangement({
        transition: 'immediate',
        mode: options.mode,
        fadeDurationSec: options.fadeDurationSec,
      });
      return;
    }

    const audioContext = this.getAudioContext();
    if (!audioContext) {
      return;
    }

    const laneBuffers = new Map<RoomMusicLaneId, AudioBuffer>();
    await Promise.all(ROOM_MUSIC_LANE_IDS.map(async (laneId) => {
      const assignments = nextArrangement.arrangement.laneAssignments[laneId];
      if (!this.isLaneAssignmentsEmpty(assignments)) {
        laneBuffers.set(laneId, await this.loadLaneLoopBuffer(nextArrangement.packId, laneId, assignments));
      }
    }));
    if (!this.isCurrentPlaybackRequest(requestId)) {
      this.recordPlaybackRequestStatus(requestId, options.mode, getRoomMusicKey(nextArrangement), 'stale');
      return;
    }

    const now = audioContext.currentTime;
    const { startAt, stopAt, quantizeToBar, fadeDuration, loopOffset, hasPriorPlayback } =
      this.prepareTransition(nextArrangement, options, now);

    if (this.activePattern) {
      this.scheduleStopPlayback(this.activePattern, {
        stopAt,
        fadeDuration,
      });
      this.activePattern = null;
    }

    for (const laneId of ROOM_MUSIC_LANE_IDS) {
      const nextBarClipIds = nextArrangement.arrangement.laneAssignments[laneId];
      const nextPatternKey = this.getLanePatternKey(nextArrangement.packId, laneId, nextBarClipIds);
      const currentPlayback = this.activeLanes.get(laneId) ?? null;
      if (
        currentPlayback &&
        (options.transition !== 'room' || quantizeToBar) &&
        currentPlayback.playbackId === nextPatternKey &&
        (currentPlayback.stopTime === null || currentPlayback.stopTime > now)
      ) {
        continue;
      }

      if (currentPlayback) {
        this.scheduleStopPlayback(currentPlayback, {
          stopAt,
          fadeDuration,
        });
        this.activeLanes.delete(laneId);
      }

      if (this.isLaneAssignmentsEmpty(nextBarClipIds)) {
        continue;
      }

      const buffer = laneBuffers.get(laneId);
      if (!buffer) continue;
      const lane = getRoomMusicLane(pack, laneId);
      const playback = this.startLoopPlayback(nextPatternKey, buffer, {
        loopDurationSec: pack.loopDurationSec,
        startAt,
        offsetSec: loopOffset,
        fadeInDuration: hasPriorPlayback ? fadeDuration : 0.08,
        startSilent: hasPriorPlayback,
        baseGain: lane?.defaultGain ?? 0.6,
      });
      this.activeLanes.set(laneId, playback);
    }

    this.currentArrangement = nextArrangement;
    this.recordPlaybackRequestStatus(requestId, options.mode, getRoomMusicKey(nextArrangement), 'started');
  }

  private async playPatternArrangement(
    nextArrangement: Extract<RoomMusic, { kind: 'pattern' }>,
    options: {
      mode: PlaybackMode;
      transition?: TransitionMode;
      fadeDurationSec?: number;
    },
    requestId: number,
  ): Promise<void> {
    const audioContext = this.getAudioContext();
    if (!audioContext) {
      return;
    }

    // Stems are mixed live, so music that differs only in volume/pan keeps playing.
    const nextPatternKey = getRoomMusicContentKey(nextArrangement) ?? 'pattern';
    if (
      this.activePattern &&
      this.activePattern.playbackId === nextPatternKey &&
      (this.activePattern.stopTime === null || this.activePattern.stopTime > audioContext.currentTime)
    ) {
      this.applyStemMix(this.activePattern, nextArrangement.mix);
      this.currentArrangement = cloneRoomMusic(nextArrangement);
      this.recordPlaybackRequestStatus(requestId, options.mode, nextPatternKey, 'already-playing');
      return;
    }

    const loopDurationSec = getRoomMusicLoopDurationSec(nextArrangement);
    const buffer = await this.loadPatternStemBuffer(nextArrangement, nextPatternKey);
    if (!this.isCurrentPlaybackRequest(requestId)) {
      this.recordPlaybackRequestStatus(requestId, options.mode, nextPatternKey, 'stale');
      return;
    }
    const now = audioContext.currentTime;
    const { startAt, stopAt, fadeDuration, loopOffset, hasPriorPlayback } =
      this.prepareTransition(nextArrangement, options, now);

    for (const playback of this.activeLanes.values()) {
      this.scheduleStopPlayback(playback, {
        stopAt,
        fadeDuration,
      });
    }
    this.activeLanes.clear();

    if (this.activePattern) {
      this.scheduleStopPlayback(this.activePattern, {
        stopAt,
        fadeDuration,
      });
      this.activePattern = null;
    }

    this.activePattern = this.startLoopPlayback(nextPatternKey, buffer, {
      loopDurationSec,
      startAt,
      offsetSec: loopOffset,
      fadeInDuration: hasPriorPlayback ? fadeDuration : 0.08,
      startSilent: hasPriorPlayback,
      baseGain: 1,
      stems: { lanes: this.stemLanes.get(buffer) ?? [], mix: nextArrangement.mix },
    });
    this.currentArrangement = nextArrangement;
    this.recordPlaybackRequestStatus(requestId, options.mode, nextPatternKey, 'started');
  }

  private async playPhraseArrangement(
    nextArrangement: RoomPhraseArrangementMusic,
    options: {
      mode: PlaybackMode;
      transition?: TransitionMode;
      fadeDurationSec?: number;
    },
    requestId: number,
  ): Promise<void> {
    const audioContext = this.getAudioContext();
    if (!audioContext) {
      return;
    }

    const nextArrangementKey = getRoomMusicContentKey(nextArrangement) ?? 'phraseArrangement';
    if (
      this.activePattern &&
      this.activePattern.playbackId === nextArrangementKey &&
      (this.activePattern.stopTime === null || this.activePattern.stopTime > audioContext.currentTime)
    ) {
      this.applyStemMix(this.activePattern, nextArrangement.mix);
      this.currentArrangement = cloneRoomMusic(nextArrangement);
      this.recordPlaybackRequestStatus(requestId, options.mode, nextArrangementKey, 'already-playing');
      return;
    }

    const loopDurationSec = getRoomMusicLoopDurationSec(nextArrangement);
    const { timeline, segments } = await this.loadArrangementTimeline(audioContext, nextArrangement);
    const openHatVoice = timeline.lanes.has('drums') ? await this.loadOpenHatVoice(audioContext) : null;
    if (!this.isCurrentPlaybackRequest(requestId)) {
      this.recordPlaybackRequestStatus(requestId, options.mode, nextArrangementKey, 'stale');
      return;
    }
    const now = audioContext.currentTime;
    const { startAt, stopAt, fadeDuration, loopOffset, hasPriorPlayback } =
      this.prepareTransition(nextArrangement, options, now);

    for (const playback of this.activeLanes.values()) {
      this.scheduleStopPlayback(playback, {
        stopAt,
        fadeDuration,
      });
    }
    this.activeLanes.clear();

    if (this.activePattern) {
      this.scheduleStopPlayback(this.activePattern, {
        stopAt,
        fadeDuration,
      });
      this.activePattern = null;
    }

    this.activePattern = this.startArrangementPlayback(nextArrangementKey, timeline, segments, openHatVoice, {
      loopDurationSec,
      startAt,
      offsetSec: loopOffset,
      fadeInDuration: hasPriorPlayback ? fadeDuration : 0.08,
      startSilent: hasPriorPlayback,
      baseGain: 1,
      mix: nextArrangement.mix,
    });
    this.currentArrangement = nextArrangement;
    this.recordPlaybackRequestStatus(requestId, options.mode, nextArrangementKey, 'started');
  }

  private prepareTransition(
    next: RoomMusic,
    options: { transition?: TransitionMode; fadeDurationSec?: number },
    now: number,
  ) {
    const playbacks = [...this.activeLanes.values(), ...(this.activePattern ? [this.activePattern] : [])];
    const plan = getMusicTransitionPlan({
      prior: this.currentArrangement,
      next,
      now,
      transportStartTime: this.transportStartTime,
      hasPriorPlayback: playbacks.length > 0,
      hasAudiblePlayback: playbacks.some(playback => playback.startTime <= now && (playback.stopTime === null || playback.stopTime > now)),
      transition: options.transition ?? 'bar',
      fadeDurationSec: options.fadeDurationSec,
    });
    // A newer target also owns tails from earlier transitions. Shorten those
    // already-retiring sources rather than leaving a discarded bar-long stop.
    for (const playback of [...this.retiringPlaybacks]) {
      this.scheduleStopPlayback(playback, {
        stopAt: now,
        fadeDuration: options.transition === 'room' ? 0.3 : IMMEDIATE_FADE_DURATION_SEC,
      });
    }
    this.transportStartTime = plan.transportStartTime;
    return plan;
  }

  private hasActivePlaybacks(): boolean {
    return this.activePattern !== null || this.activeLanes.size > 0;
  }

  private beginPlaybackRequest(mode: PlaybackMode, arrangementKey: string | null): number {
    const id = this.invalidatePlaybackRequests();
    this.lastPlaybackRequest = {
      at: Date.now(),
      id,
      mode,
      arrangementKey,
      status: 'pending',
    };
    return id;
  }

  private invalidatePlaybackRequests(): number {
    this.playbackRequestSerial += 1;
    return this.playbackRequestSerial;
  }

  private isCurrentPlaybackRequest(requestId: number): boolean {
    return requestId === this.playbackRequestSerial;
  }

  private recordPlaybackRequestStatus(
    id: number,
    mode: PlaybackMode,
    arrangementKey: string | null,
    status: PlaybackRequestStatus,
    error?: unknown,
  ): void {
    const entry: PlaybackRequestDebugEntry = {
      at: Date.now(),
      id,
      mode,
      arrangementKey,
      status,
      ...(error ? normalizeAudioError(error) : {}),
    };

    if (status === 'stale' && this.lastPlaybackRequest?.id !== id) {
      this.lastStalePlaybackRequest = entry;
      return;
    }

    this.lastPlaybackRequest = entry;
  }

  private getLanePatternKey(
    packId: string,
    laneId: RoomMusicLaneId,
    assignments: readonly RoomMusicBarClipId[],
  ): string {
    return `${packId}:${laneId}:${assignments.map((clipId) => clipId ?? '-').join('|')}`;
  }

  private isLaneAssignmentsEmpty(assignments: readonly RoomMusicBarClipId[]): boolean {
    return assignments.every((clipId) => clipId === null);
  }

  private getAudioContext(): AudioContext | null {
    if (this.audioContext) {
      return this.audioContext;
    }

    const AudioContextCtor =
      window.AudioContext ??
      ((window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);
    if (!AudioContextCtor) {
      return null;
    }

    this.audioContext = new AudioContextCtor();
    this.lastAudioContextStateChange = {
      at: Date.now(),
      state: this.audioContext.state,
    };
    this.audioContext.addEventListener('statechange', () => {
      this.lastAudioContextStateChange = {
        at: Date.now(),
        state: this.audioContext?.state ?? 'unknown',
      };
    });
    if (this.lifecycleDocument?.hidden) this.suspendAudioContext();
    return this.audioContext;
  }

  private ensureMasterGain(audioContext: AudioContext | null): GainNode | null {
    if (!audioContext) {
      return null;
    }

    if (this.masterGain) {
      return this.masterGain;
    }

    this.masterGain = audioContext.createGain();
    this.masterGain.gain.setValueAtTime(this.getMasterGainValue(), audioContext.currentTime);
    this.masterGain.connect(audioContext.destination);
    return this.masterGain;
  }

  private getMasterGainValue(): number {
    return 0.82 * GLOBAL_MUSIC_VOLUME_MULTIPLIER * this.volume;
  }

  private async loadBuffer(packId: string, clipId: string): Promise<AudioBuffer> {
    const cacheKey = `${packId}:${clipId}`;
    const cached = this.bufferCache.get(`clip:${cacheKey}`);
    if (cached) {
      return cached;
    }

    const pack = getRoomMusicPack(packId);
    const clip = pack ? getRoomMusicClip(pack, clipId) : null;
    if (!pack || !clip) {
      throw new Error(`Unknown music clip ${cacheKey}.`);
    }

    const bufferPromise = fetch(resolveAssetUrl(clip.assetPath))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load ${clip.assetPath}.`);
        }
        return response.arrayBuffer();
      })
      .then(async (arrayBuffer) => {
        const audioContext = this.getAudioContext();
        if (!audioContext) {
          throw new Error('Web Audio is unavailable.');
        }
        return audioContext.decodeAudioData(arrayBuffer.slice(0));
      });

    this.bufferCache.set(`clip:${cacheKey}`, 'clip', bufferPromise);
    return bufferPromise;
  }

  private async loadLaneLoopBuffer(
    packId: string,
    laneId: RoomMusicLaneId,
    assignments: RoomMusicLaneBarAssignments,
  ): Promise<AudioBuffer> {
    const cacheKey = this.getLanePatternKey(packId, laneId, assignments);
    const cached = this.bufferCache.get(`lane:${cacheKey}`);
    if (cached) {
      return cached;
    }

    const laneBufferPromise = (async () => {
      const pack = getRoomMusicPack(packId);
      const audioContext = this.getAudioContext();
      if (!pack || !audioContext) {
        throw new Error('Web Audio is unavailable.');
      }

      const clipIds = [...new Set(assignments.filter((clipId): clipId is string => Boolean(clipId)))];
      const clipBuffers = new Map<string, AudioBuffer>();
      await Promise.all(
        clipIds.map(async (clipId) => {
          clipBuffers.set(clipId, await this.loadBuffer(packId, clipId));
        }),
      );

      const sampleRate = audioContext.sampleRate;
      const totalSamples = Math.max(1, Math.round(pack.loopDurationSec * sampleRate));
      const barDuration = this.getBarDuration(pack);
      const barSamples = Math.max(1, Math.round(barDuration * sampleRate));
      const channelCount = Math.max(
        1,
        ...[...clipBuffers.values()].map((buffer) => buffer.numberOfChannels),
      );
      const laneBuffer = audioContext.createBuffer(channelCount, totalSamples, sampleRate);

      for (let barIndex = 0; barIndex < pack.barCount; barIndex += 1) {
        const clipId = assignments[barIndex] ?? null;
        if (!clipId) {
          continue;
        }

        const sourceBuffer = clipBuffers.get(clipId);
        if (!sourceBuffer) {
          continue;
        }

        const sourceOffset = Math.min(
          sourceBuffer.length,
          Math.round(barIndex * barDuration * sampleRate),
        );
        const destinationOffset = Math.min(totalSamples, Math.round(barIndex * barDuration * sampleRate));
        const segmentLength = Math.min(
          barSamples,
          totalSamples - destinationOffset,
          sourceBuffer.length - sourceOffset,
        );
        if (segmentLength <= 0) {
          continue;
        }

        for (let channel = 0; channel < channelCount; channel += 1) {
          const targetData = laneBuffer.getChannelData(channel);
          const sourceChannel = Math.min(channel, sourceBuffer.numberOfChannels - 1);
          const sourceData = sourceBuffer.getChannelData(sourceChannel);
          targetData.set(
            sourceData.subarray(sourceOffset, sourceOffset + segmentLength),
            destinationOffset,
          );
        }
      }

      return laneBuffer;
    })();

    this.bufferCache.set(`lane:${cacheKey}`, 'loop', laneBufferPromise);
    return laneBufferPromise;
  }

  private async loadPatternStemBuffer(
    pattern: Extract<RoomMusic, { kind: 'pattern' }>,
    contentKey: string,
  ): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(`pattern-stems:${contentKey}`);
    if (cached) {
      return cached;
    }

    const bufferPromise = Promise.resolve().then(async () => {
      const audioContext = this.getAudioContext();
      if (!audioContext) {
        throw new Error('Web Audio is unavailable.');
      }

      const buffer = await renderRoomPatternStemBuffer(audioContext, pattern);
      this.stemLanes.set(buffer, getRoomPatternStemLanes(pattern));
      return buffer;
    });

    this.bufferCache.set(`pattern-stems:${contentKey}`, 'loop', bufferPromise);
    return bufferPromise;
  }

  /** Each filled slot's lane segment, rendering only phrases not already playing or cached. */
  private async loadArrangementTimeline(
    audioContext: AudioContext,
    arrangement: RoomPhraseArrangementMusic,
  ): Promise<{ timeline: ArrangementTimeline; segments: Map<string, ArrangementLaneSegment> }> {
    const phraseById = await loadMusicPhrasesById(collectRoomPhraseArrangementPhraseIds(arrangement));
    const slotCount = getRoomPhraseArrangementActiveSlotCount(arrangement);
    const slotDurationSec = getRoomMusicBarDurationSec(arrangement) * arrangement.segmentBarCount;
    const playing = this.activePattern?.segments ?? null;
    const segments = new Map<string, ArrangementLaneSegment>();
    const lanes = new Map<RoomPatternInstrumentId, (ArrangementLaneSegment | null)[]>();
    const pending: Promise<void>[] = [];
    for (const instrumentId of ROOM_PATTERN_INSTRUMENT_IDS) {
      const laneSegments: (ArrangementLaneSegment | null)[] = Array.from({ length: slotCount }, () => null);
      for (let slot = 0; slot < slotCount; slot += 1) {
        const phraseId = arrangement.slots[instrumentId][slot];
        const phrase = phraseId ? phraseById.get(phraseId) : undefined;
        if (!phrase || phrase.instrumentId !== instrumentId) {
          continue;
        }
        pending.push(this.loadArrangementSegment(audioContext, arrangement, phrase, playing).then(({ key, segment }) => {
          laneSegments[slot] = segment;
          segments.set(key, segment);
        }));
      }
      if (arrangement.slots[instrumentId].slice(0, slotCount).some((phraseId) => phraseId && phraseById.has(phraseId))) {
        lanes.set(instrumentId, laneSegments);
      }
    }
    await Promise.all(pending);
    for (const [instrumentId, laneSegments] of lanes) {
      if (laneSegments.every((segment) => segment === null)) lanes.delete(instrumentId);
    }
    return {
      timeline: {
        sampleRate: audioContext.sampleRate,
        slotDurationSec,
        slotCount,
        lanes,
      },
      segments,
    };
  }

  private async loadArrangementSegment(
    audioContext: AudioContext,
    arrangement: RoomPhraseArrangementMusic,
    phrase: MusicPhraseRecord,
    playing: Map<string, ArrangementLaneSegment> | null,
  ): Promise<{ key: string; segment: ArrangementLaneSegment }> {
    // A phrase rendered alone in the arrangement's tempo, key and octave is its slot,
    // shared by every slot that uses it.
    const { key, sequence } = buildMusicPhraseAudition(phrase, arrangement, { adoptPhraseTiming: false, adoptPhraseKey: false });
    const reused = playing?.get(key);
    if (reused) {
      return { key, segment: reused };
    }

    const cacheKey = `arrange-segment:${audioContext.sampleRate}:${key}`;
    let bufferPromise = this.bufferCache.get(cacheKey);
    if (!bufferPromise) {
      bufferPromise = renderRoomPatternLaneSegment(audioContext, sequence, phrase.instrumentId);
      this.bufferCache.set(cacheKey, 'segment', bufferPromise);
    }
    const buffer = await bufferPromise;
    const hats = phrase.instrumentId === 'drums'
      ? getRoomPatternHatTiming(sequence, audioContext.sampleRate)
      : { hatTimesSec: [], trailingOpenHatSec: null };
    return { key, segment: { buffer, ...hats } };
  }

  private loadOpenHatVoice(audioContext: AudioContext): Promise<AudioBuffer | null> {
    this.openHatVoice ??= renderRoomPatternOpenHatVoice(audioContext).catch(() => {
      this.openHatVoice = null;
      return null;
    });
    return this.openHatVoice;
  }

  private startArrangementPlayback(
    playbackId: string,
    timeline: ArrangementTimeline,
    segments: Map<string, ArrangementLaneSegment>,
    openHatVoice: AudioBuffer | null,
    options: {
      loopDurationSec: number;
      startAt: number;
      offsetSec: number;
      fadeInDuration: number;
      startSilent: boolean;
      baseGain: number;
      mix: RoomPatternInstrumentMix;
    },
  ): ActiveLoopPlayback {
    const audioContext = this.getAudioContext();
    const masterGain = this.ensureMasterGain(audioContext);
    if (!audioContext || !masterGain) {
      throw new Error('Web Audio is unavailable.');
    }

    const gain = this.createPlaybackGain(audioContext, options);
    const stemMix = this.connectStemMix(audioContext, gain, { lanes: [...timeline.lanes.keys()], mix: options.mix, drive: true });
    gain.connect(masterGain);
    const scheduler = new PhraseArrangementScheduler(
      audioContext,
      timeline,
      stemMix.inputs,
      openHatVoice,
      options.startAt - options.offsetSec,
      options.startAt,
    );
    scheduler.start();
    void this.resumeAudioContext('start-arrangement-playback');

    return {
      playbackId,
      source: null,
      scheduler,
      segments,
      gain,
      stemMix,
      startTime: options.startAt,
      stopTime: null,
      baseGain: options.baseGain,
      loopDurationSec: options.loopDurationSec,
      fadeInDuration: options.fadeInDuration,
      fadeOut: null,
    };
  }

  private createPlaybackGain(
    audioContext: AudioContext,
    options: { startAt: number; fadeInDuration: number; startSilent: boolean; baseGain: number },
  ): GainNode {
    const gain = audioContext.createGain();
    const initialGain = options.startSilent || options.fadeInDuration > 0 ? 0 : options.baseGain;
    gain.gain.setValueAtTime(initialGain, Math.max(audioContext.currentTime, options.startAt - 0.02));
    if (options.fadeInDuration > 0) {
      gain.gain.setValueAtTime(0, options.startAt);
      gain.gain.linearRampToValueAtTime(options.baseGain, options.startAt + options.fadeInDuration);
    }
    return gain;
  }

  private startLoopPlayback(
    playbackId: string,
    buffer: AudioBuffer,
    options: {
      loopDurationSec: number;
      startAt: number;
      offsetSec: number;
      fadeInDuration: number;
      startSilent: boolean;
      baseGain: number;
      stems?: { lanes: readonly RoomPatternInstrumentId[]; mix: RoomPatternInstrumentMix };
    },
  ): ActiveLoopPlayback {
    const audioContext = this.getAudioContext();
    const masterGain = this.ensureMasterGain(audioContext);
    if (!audioContext || !masterGain) {
      throw new Error('Web Audio is unavailable.');
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = Math.min(options.loopDurationSec, buffer.duration);

    const gain = this.createPlaybackGain(audioContext, options);
    let stemMix: StemMix | null = null;
    if (options.stems) {
      stemMix = this.connectStemMix(audioContext, gain, { ...options.stems, drive: false });
      const splitter = audioContext.createChannelSplitter(Math.max(1, options.stems.lanes.length));
      source.connect(splitter);
      options.stems.lanes.forEach((instrumentId, channel) => {
        const input = stemMix?.inputs.get(instrumentId);
        if (input) splitter.connect(input, channel);
      });
      stemMix.nodes.push(splitter);
    } else {
      source.connect(gain);
    }
    gain.connect(masterGain);
    source.start(options.startAt, options.offsetSec);
    void this.resumeAudioContext('start-loop-playback');

    return {
      playbackId,
      source,
      scheduler: null,
      segments: null,
      gain,
      stemMix,
      startTime: options.startAt,
      stopTime: null,
      baseGain: options.baseGain,
      loopDurationSec: options.loopDurationSec,
      fadeInDuration: options.fadeInDuration,
      fadeOut: null,
    };
  }

  /**
   * Per lane: [drive] → lane gain → pan, summed into a bus → tanh soft clip → the
   * playback's fade gain. Pattern stems already carry their drive; raw Arrange
   * segments get it here (`drive`) because tails of neighboring slots must sum first.
   */
  private connectStemMix(
    audioContext: AudioContext,
    output: GainNode,
    stems: { lanes: readonly RoomPatternInstrumentId[]; mix: RoomPatternInstrumentMix; drive: boolean },
  ): StemMix {
    const bus = audioContext.createGain();
    bus.gain.value = 1 / STEM_BUS_HEADROOM;
    const shaper = audioContext.createWaveShaper();
    shaper.curve = this.getStemOutputCurve();
    bus.connect(shaper);
    shaper.connect(output);

    const stemMix: StemMix = { lanes: new Map(), inputs: new Map(), nodes: [bus, shaper] };
    stems.lanes.forEach((instrumentId) => {
      const gain = audioContext.createGain();
      const laneDrive = stems.drive ? ROOM_PATTERN_LANE_DRIVE[instrumentId] : undefined;
      if (laneDrive) {
        const headroom = audioContext.createGain();
        headroom.gain.value = 1 / LANE_DRIVE_HEADROOM;
        const drive = audioContext.createWaveShaper();
        drive.curve = this.getLaneDriveCurve(instrumentId, laneDrive);
        headroom.connect(drive);
        drive.connect(gain);
        stemMix.inputs.set(instrumentId, headroom);
        stemMix.nodes.push(headroom, drive);
      } else {
        stemMix.inputs.set(instrumentId, gain);
      }
      let panner: StereoPannerNode | null = null;
      if (typeof audioContext.createStereoPanner === 'function') {
        panner = audioContext.createStereoPanner();
        gain.connect(panner);
        panner.connect(bus);
        stemMix.nodes.push(gain, panner);
      } else {
        gain.connect(bus);
        stemMix.nodes.push(gain);
      }
      // Without a panner the lane plays centered at the equal-power center level.
      const scale = panner ? 1 : Math.SQRT1_2;
      gain.gain.value = getRoomPatternLaneGain(instrumentId, stems.mix[instrumentId].volume) * scale;
      if (panner) {
        panner.pan.value = Math.max(-1, Math.min(1, stems.mix[instrumentId].pan));
      }
      stemMix.lanes.set(instrumentId, { gain, panner, scale });
    });
    return stemMix;
  }

  private applyStemMix(playback: ActiveLoopPlayback, mix: RoomPatternInstrumentMix): void {
    const audioContext = this.audioContext;
    if (!audioContext || !playback.stemMix) {
      return;
    }

    const now = audioContext.currentTime;
    for (const [instrumentId, lane] of playback.stemMix.lanes) {
      lane.gain.gain.setTargetAtTime(
        getRoomPatternLaneGain(instrumentId, mix[instrumentId].volume) * lane.scale,
        now,
        STEM_MIX_TIME_CONSTANT_SEC,
      );
      lane.panner?.pan.setTargetAtTime(Math.max(-1, Math.min(1, mix[instrumentId].pan)), now, STEM_MIX_TIME_CONSTANT_SEC);
    }
  }

  private getLaneDriveCurve(
    instrumentId: RoomPatternInstrumentId,
    laneDrive: { drive: number; outputGain: number },
  ): Float32Array<ArrayBuffer> {
    let curve = this.laneDriveCurves.get(instrumentId);
    if (!curve) {
      curve = new Float32Array(STEM_CURVE_POINTS);
      const normalizer = Math.tanh(laneDrive.drive);
      for (let index = 0; index < STEM_CURVE_POINTS; index += 1) {
        const input = ((index / (STEM_CURVE_POINTS - 1)) * 2 - 1) * LANE_DRIVE_HEADROOM;
        curve[index] = (Math.tanh(input * laneDrive.drive) / normalizer) * laneDrive.outputGain;
      }
      this.laneDriveCurves.set(instrumentId, curve);
    }
    return curve;
  }

  private getStemOutputCurve(): Float32Array<ArrayBuffer> {
    if (!this.stemOutputCurve) {
      const curve = new Float32Array(STEM_CURVE_POINTS);
      for (let index = 0; index < STEM_CURVE_POINTS; index += 1) {
        const input = (index / (STEM_CURVE_POINTS - 1)) * 2 - 1;
        curve[index] = Math.tanh(input * STEM_BUS_HEADROOM * ROOM_PATTERN_OUTPUT_DRIVE);
      }
      this.stemOutputCurve = curve;
    }
    return this.stemOutputCurve;
  }

  private getPlaybackGainAtTime(playback: ActiveLoopPlayback, time: number): number {
    if (playback.fadeOut && time >= playback.fadeOut.start) {
      const progress = Math.min(1, (time - playback.fadeOut.start) / (playback.fadeOut.end - playback.fadeOut.start));
      return playback.fadeOut.startGain * (1 - progress);
    }
    const progress = playback.fadeInDuration > 0
      ? Math.min(1, Math.max(0, (time - playback.startTime) / playback.fadeInDuration))
      : 1;
    return playback.baseGain * progress;
  }

  private scheduleStopPlayback(
    playback: ActiveLoopPlayback,
    options: {
      stopAt: number;
      fadeDuration: number;
    },
  ): void {
    const audioContext = this.audioContext;
    if (!audioContext) {
      return;
    }

    const fadeStart = Math.max(audioContext.currentTime, options.stopAt);
    const fadeEnd = fadeStart + Math.max(0.02, options.fadeDuration);

    try {
      const alreadyRetiring = this.retiringPlaybacks.has(playback);
      const param = playback.gain.gain;
      if (playback.startTime > audioContext.currentTime) {
        // A superseded queued room must never become audible at its future start.
        param.cancelScheduledValues(audioContext.currentTime);
        param.setValueAtTime(0, audioContext.currentTime);
        playback.source?.stop(audioContext.currentTime);
        playback.scheduler?.stop(audioContext.currentTime);
        playback.stopTime = audioContext.currentTime;
        playback.fadeOut = null;
      } else {
        const startGain = this.getPlaybackGainAtTime(playback, fadeStart);
        if (typeof param.cancelAndHoldAtTime === 'function') {
          param.cancelAndHoldAtTime(fadeStart);
        } else {
          param.cancelScheduledValues(audioContext.currentTime);
          param.setValueAtTime(startGain, fadeStart);
        }
        param.linearRampToValueAtTime(0, fadeEnd);
        playback.source?.stop(fadeEnd + 0.05);
        playback.scheduler?.stop(fadeEnd + 0.05);
        playback.stopTime = fadeEnd + 0.05;
        playback.fadeOut = { start: fadeStart, end: fadeEnd, startGain };
      }
      this.retiringPlaybacks.add(playback);
      if (alreadyRetiring) return;
      const onEnded = () => {
          this.retiringPlaybacks.delete(playback);
          playback.scheduler?.dispose();
          try {
            playback.source?.disconnect();
          } catch {
            void 0;
          }
          try {
            playback.gain.disconnect();
          } catch {
            void 0;
          }
          for (const node of playback.stemMix?.nodes ?? []) {
            try {
              node.disconnect();
            } catch {
              void 0;
            }
          }
      };
      if (playback.source) {
        playback.source.addEventListener('ended', onEnded, { once: true });
      } else {
        playback.scheduler?.onEnded(onEnded);
      }
    } catch {
      void 0;
    }
  }

  private getBarDuration(pack: { bpm: number; beatsPerBar: number }): number {
    return (60 / pack.bpm) * pack.beatsPerBar;
  }

  private getNextBarBoundary(barDurationSec: number, currentTime: number): number {
    if (barDurationSec <= 0) {
      return currentTime;
    }

    const elapsed = Math.max(0, currentTime - this.transportStartTime);
    const nextBarIndex = Math.floor(elapsed / barDurationSec) + 1;
    return this.transportStartTime + nextBarIndex * barDurationSec;
  }

  private suspendAudioContext(): void {
    if (this.audioContext?.state === 'running') {
      void this.audioContext.suspend().catch(() => void 0);
    }
  }

  private async resumeAudioContext(trigger: string): Promise<void> {
    if (this.lifecycleDocument?.hidden) {
      this.suspendAudioContext();
      return;
    }
    const stateBefore = this.audioContext?.state ?? null;
    if (!this.audioContext) {
      this.lastResumeAttempt = {
        at: Date.now(),
        trigger,
        status: 'no-context',
        stateBefore,
        stateAfter: null,
      };
      return;
    }

    if (this.audioContext.state === 'running') {
      this.lastResumeAttempt = {
        at: Date.now(),
        trigger,
        status: 'already-running',
        stateBefore,
        stateAfter: this.audioContext.state,
      };
      return;
    }

    try {
      await this.audioContext.resume();
      if (this.lifecycleDocument?.hidden) {
        await this.audioContext.suspend();
        return;
      }
      const stateAfter: string = this.audioContext.state;
      this.lastResumeAttempt = {
        at: Date.now(),
        trigger,
        status: stateAfter === 'running' ? 'resumed' : 'failed',
        stateBefore,
        stateAfter,
      };
    } catch (error) {
      this.lastResumeAttempt = {
        at: Date.now(),
        trigger,
        status: 'failed',
        stateBefore,
        stateAfter: this.audioContext.state,
        ...normalizeAudioError(error),
      };
    }
  }
}

function normalizeAudioError(error: unknown): { errorName: string; errorMessage: string } {
  if (error instanceof Error) {
    return {
      errorName: error.name || 'Error',
      errorMessage: error.message || '',
    };
  }

  if (typeof error === 'object' && error !== null) {
    const value = error as { name?: unknown; message?: unknown };
    return {
      errorName: typeof value.name === 'string' ? value.name : 'UnknownError',
      errorMessage: typeof value.message === 'string' ? value.message : '',
    };
  }

  return {
    errorName: 'UnknownError',
    errorMessage: typeof error === 'string' ? error : '',
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value));
}

export const globalRoomMusicController = new RoomMusicController();

export function initRoomMusic(windowObj: Window = window): void {
  globalRoomMusicController.init(windowObj);
}
