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
import { renderRoomPatternLoopBuffer } from './patternRenderer';
import {
  buildPlaybackSequenceFromPhraseArrangement,
  collectRoomPhraseArrangementPhraseIds,
} from './phraseArrangement';
import { getPatternDrumSamples } from './patternKit';
import {
  getPatternDrumRowForGridRow,
  getPatternRowNote,
  type RoomPatternDrumRowId,
  type RoomPatternInstrumentId,
  type RoomPatternMusic,
  type RoomPatternTonalInstrumentId,
} from './pattern';

type TransitionMode = MusicTransitionMode;
type PlaybackMode = 'idle' | 'editor-preview' | 'world-play';

type ActiveLoopPlayback = {
  playbackId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
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
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private volume = 1;
  private transportStartTime = 0;
  private activeLanes = new Map<RoomMusicLaneId, ActiveLoopPlayback>();
  private activePattern: ActiveLoopPlayback | null = null;
  private readonly retiringPlaybacks = new Set<ActiveLoopPlayback>();
  private previewClipPlayback: PreviewClipPlayback | null = null;
  private readonly oneShotPlaybacks = new Set<OneShotPlayback>();
  private readonly bufferCache = new RoomMusicBufferCache();
  private currentArrangement: RoomMusic | null = null;
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
      if (!windowObj.document.hidden) {
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
    const pack = getRoomMusicPack(packId);
    const clip = pack ? getRoomMusicClip(pack, clipId) : null;
    if (!pack || !clip) {
      this.stopPreviewClip();
      return;
    }

    const buffer = await this.loadBuffer(packId, clipId);
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

  stopPreviewClip(): void {
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

    this.volume = nextVolume;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setTargetAtTime(
        this.getMasterGainValue(),
        this.audioContext.currentTime,
        0.02,
      );
    }
  }

  previewPatternCell(
    pattern: RoomPatternMusic,
    instrumentId: RoomPatternInstrumentId,
    row: number,
  ): void {
    this.init();
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
    const sample = (await getPatternDrumSamples(audioContext)).get(rowId);
    if (!sample) {
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

    const nextPatternKey = getRoomMusicKey(nextArrangement) ?? 'pattern';
    if (
      this.activePattern &&
      this.activePattern.playbackId === nextPatternKey &&
      (this.activePattern.stopTime === null || this.activePattern.stopTime > audioContext.currentTime)
    ) {
      this.currentArrangement = cloneRoomMusic(nextArrangement);
      this.recordPlaybackRequestStatus(requestId, options.mode, nextPatternKey, 'already-playing');
      return;
    }

    const loopDurationSec = getRoomMusicLoopDurationSec(nextArrangement);
    const buffer = await this.loadPatternLoopBuffer(nextArrangement);
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

    const nextArrangementKey = getRoomMusicKey(nextArrangement) ?? 'phraseArrangement';
    if (
      this.activePattern &&
      this.activePattern.playbackId === nextArrangementKey &&
      (this.activePattern.stopTime === null || this.activePattern.stopTime > audioContext.currentTime)
    ) {
      this.currentArrangement = cloneRoomMusic(nextArrangement);
      this.recordPlaybackRequestStatus(requestId, options.mode, nextArrangementKey, 'already-playing');
      return;
    }

    const loopDurationSec = getRoomMusicLoopDurationSec(nextArrangement);
    const buffer = await this.loadPhraseArrangementLoopBuffer(nextArrangement);
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

    this.activePattern = this.startLoopPlayback(nextArrangementKey, buffer, {
      loopDurationSec,
      startAt,
      offsetSec: loopOffset,
      fadeInDuration: hasPriorPlayback ? fadeDuration : 0.08,
      startSilent: hasPriorPlayback,
      baseGain: 1,
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

  private async loadPatternLoopBuffer(
    pattern: Extract<RoomMusic, { kind: 'pattern' }>,
  ): Promise<AudioBuffer> {
    const cacheKey = getRoomMusicKey(pattern) ?? 'pattern';
    const cached = this.bufferCache.get(`pattern:${cacheKey}`);
    if (cached) {
      return cached;
    }

    const bufferPromise = Promise.resolve().then(() => {
      const audioContext = this.getAudioContext();
      if (!audioContext) {
        throw new Error('Web Audio is unavailable.');
      }

      return renderRoomPatternLoopBuffer(audioContext, pattern);
    });

    this.bufferCache.set(`pattern:${cacheKey}`, 'loop', bufferPromise);
    return bufferPromise;
  }

  private async loadPhraseArrangementLoopBuffer(
    arrangement: RoomPhraseArrangementMusic,
  ): Promise<AudioBuffer> {
    const cacheKey = `phrase:${getRoomMusicKey(arrangement) ?? 'phraseArrangement'}`;
    const cached = this.bufferCache.get(`pattern:${cacheKey}`);
    if (cached) {
      return cached;
    }

    const bufferPromise = Promise.resolve().then(async () => {
      const audioContext = this.getAudioContext();
      if (!audioContext) {
        throw new Error('Web Audio is unavailable.');
      }

      const phraseIds = collectRoomPhraseArrangementPhraseIds(arrangement);
      const phraseById = await loadMusicPhrasesById(phraseIds);
      const sequence = buildPlaybackSequenceFromPhraseArrangement(arrangement, phraseById);
      return renderRoomPatternLoopBuffer(audioContext, sequence);
    });

    this.bufferCache.set(`pattern:${cacheKey}`, 'loop', bufferPromise);
    return bufferPromise;
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

    const gain = audioContext.createGain();
    const initialGain = options.startSilent || options.fadeInDuration > 0 ? 0 : options.baseGain;
    gain.gain.setValueAtTime(initialGain, Math.max(audioContext.currentTime, options.startAt - 0.02));
    if (options.fadeInDuration > 0) {
      gain.gain.setValueAtTime(0, options.startAt);
      gain.gain.linearRampToValueAtTime(options.baseGain, options.startAt + options.fadeInDuration);
    }

    source.connect(gain);
    gain.connect(masterGain);
    source.start(options.startAt, options.offsetSec);
    void this.resumeAudioContext('start-loop-playback');

    return {
      playbackId,
      source,
      gain,
      startTime: options.startAt,
      stopTime: null,
      baseGain: options.baseGain,
      loopDurationSec: options.loopDurationSec,
      fadeInDuration: options.fadeInDuration,
      fadeOut: null,
    };
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
        playback.source.stop(audioContext.currentTime);
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
        playback.source.stop(fadeEnd + 0.05);
        playback.stopTime = fadeEnd + 0.05;
        playback.fadeOut = { start: fadeStart, end: fadeEnd, startGain };
      }
      this.retiringPlaybacks.add(playback);
      if (alreadyRetiring) return;
      playback.source.addEventListener(
        'ended',
        () => {
          this.retiringPlaybacks.delete(playback);
          try {
            playback.source.disconnect();
          } catch {
            void 0;
          }
          try {
            playback.gain.disconnect();
          } catch {
            void 0;
          }
        },
        { once: true },
      );
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

  private async resumeAudioContext(trigger: string): Promise<void> {
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
