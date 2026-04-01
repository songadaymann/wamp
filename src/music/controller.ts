import { getRoomMusicClip, getRoomMusicPack } from './catalog';
import {
  ROOM_MUSIC_LANE_IDS,
  cloneRoomMusic,
  isRoomMusicEmpty,
  type RoomMusic,
  type RoomMusicLaneId,
} from './model';

type TransitionMode = 'immediate' | 'bar';
type PlaybackMode = 'idle' | 'editor-preview' | 'world-play';

type ActiveLanePlayback = {
  laneId: RoomMusicLaneId;
  clipId: string;
  packId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  startTime: number;
  stopTime: number | null;
};

type PreviewClipPlayback = {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
};

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
  private transportStartTime = 0;
  private activeLanes = new Map<RoomMusicLaneId, ActiveLanePlayback>();
  private previewClipPlayback: PreviewClipPlayback | null = null;
  private readonly bufferPromises = new Map<string, Promise<AudioBuffer>>();
  private currentArrangement: RoomMusic | null = null;
  private mode: PlaybackMode = 'idle';

  init(windowObj: Window = window): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    const markInteracted = () => {
      this.userInteracted = true;
      void this.resumeAudioContext();
    };

    windowObj.addEventListener('pointerdown', markInteracted, { passive: true });
    windowObj.addEventListener('keydown', markInteracted, { passive: true });
    windowObj.addEventListener('touchstart', markInteracted, { passive: true });
  }

  async playArrangement(
    music: RoomMusic | null,
    options: {
      mode: PlaybackMode;
      transition?: TransitionMode;
    },
  ): Promise<void> {
    this.init();
    this.mode = options.mode;

    if (!music || isRoomMusicEmpty(music)) {
      this.stopArrangement({ transition: options.transition ?? 'bar', mode: options.mode });
      return;
    }

    const pack = getRoomMusicPack(music.packId);
    if (!pack) {
      this.stopArrangement({ transition: 'immediate', mode: options.mode });
      return;
    }

    const nextArrangement = cloneRoomMusic(music);
    if (!nextArrangement) {
      this.stopArrangement({ transition: options.transition ?? 'bar', mode: options.mode });
      return;
    }

    const audioContext = this.getAudioContext();
    if (!audioContext) {
      return;
    }

    await Promise.all(
      ROOM_MUSIC_LANE_IDS.map(async (laneId) => {
        const clipId = nextArrangement.arrangement.laneAssignments[laneId];
        if (!clipId) {
          return;
        }
        await this.loadBuffer(nextArrangement.packId, clipId);
      }),
    );

    this.ensureTransport(audioContext.currentTime);
    const now = audioContext.currentTime;
    const hasActiveLanes = this.activeLanes.size > 0;
    const transition = options.transition ?? 'bar';
    const quantizeToBar = transition === 'bar' && hasActiveLanes;
    const startAt = quantizeToBar ? this.getNextBarBoundary(pack, now) : now + 0.02;
    const fadeDuration = quantizeToBar ? this.getBarDuration(pack) : 0.18;

    for (const laneId of ROOM_MUSIC_LANE_IDS) {
      const nextClipId = nextArrangement.arrangement.laneAssignments[laneId];
      const currentPlayback = this.activeLanes.get(laneId) ?? null;
      if (
        currentPlayback &&
        currentPlayback.packId === nextArrangement.packId &&
        currentPlayback.clipId === nextClipId &&
        (currentPlayback.stopTime === null || currentPlayback.stopTime > now)
      ) {
        continue;
      }

      if (currentPlayback) {
        this.scheduleStopPlayback(currentPlayback, {
          stopAt: quantizeToBar ? startAt : now,
          fadeDuration,
        });
        this.activeLanes.delete(laneId);
      }

      if (!nextClipId) {
        continue;
      }

      const buffer = await this.loadBuffer(nextArrangement.packId, nextClipId);
      const playback = this.startLoopPlayback(nextArrangement.packId, laneId, nextClipId, buffer, {
        loopDurationSec: pack.loopDurationSec,
        startAt,
        offsetSec: this.getLoopOffsetAtTime(pack.loopDurationSec, startAt),
        fadeInDuration: hasActiveLanes ? fadeDuration : 0.1,
        startSilent: hasActiveLanes,
      });
      this.activeLanes.set(laneId, playback);
    }

    this.currentArrangement = nextArrangement;
  }

  stopArrangement(options?: {
    transition?: TransitionMode;
    mode?: PlaybackMode;
  }): void {
    const audioContext = this.audioContext;
    if (!audioContext) {
      this.currentArrangement = null;
      this.mode = options?.mode ?? 'idle';
      return;
    }

    const packId = this.currentArrangement?.packId ?? 'wamp-v1';
    const pack = getRoomMusicPack(packId);
    const now = audioContext.currentTime;
    const transition = options?.transition ?? 'bar';
    const quantizeToBar = transition === 'bar' && this.activeLanes.size > 0 && pack !== null;
    const stopAt = quantizeToBar && pack ? this.getNextBarBoundary(pack, now) : now;
    const fadeDuration = quantizeToBar && pack ? this.getBarDuration(pack) : 0.18;

    for (const playback of this.activeLanes.values()) {
      this.scheduleStopPlayback(playback, { stopAt, fadeDuration });
    }
    this.activeLanes.clear();
    this.currentArrangement = null;
    this.mode = options?.mode ?? 'idle';
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
    void this.resumeAudioContext();
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

  getDebugState(): Record<string, unknown> {
    return {
      initialized: this.initialized,
      userInteracted: this.userInteracted,
      mode: this.mode,
      transportStartTime: this.transportStartTime,
      activeLanes: Array.from(this.activeLanes.values()).map((playback) => ({
        laneId: playback.laneId,
        clipId: playback.clipId,
        startTime: Number(playback.startTime.toFixed(3)),
        stopTime: playback.stopTime === null ? null : Number(playback.stopTime.toFixed(3)),
      })),
      currentArrangement: cloneRoomMusic(this.currentArrangement),
      previewClipId: this.previewClipPlayback?.clipId ?? null,
    };
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
    this.masterGain.gain.setValueAtTime(0.82, audioContext.currentTime);
    this.masterGain.connect(audioContext.destination);
    return this.masterGain;
  }

  private ensureTransport(currentTime: number): void {
    if (this.transportStartTime > 0) {
      return;
    }

    this.transportStartTime = currentTime;
  }

  private async loadBuffer(packId: string, clipId: string): Promise<AudioBuffer> {
    const cacheKey = `${packId}:${clipId}`;
    const cached = this.bufferPromises.get(cacheKey);
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

    this.bufferPromises.set(cacheKey, bufferPromise);
    return bufferPromise;
  }

  private startLoopPlayback(
    packId: string,
    laneId: RoomMusicLaneId,
    clipId: string,
    buffer: AudioBuffer,
    options: {
      loopDurationSec: number;
      startAt: number;
      offsetSec: number;
      fadeInDuration: number;
      startSilent: boolean;
    },
  ): ActiveLanePlayback {
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
    const baseGain = 1;
    const initialGain = options.startSilent ? 0 : baseGain;
    gain.gain.setValueAtTime(initialGain, Math.max(audioContext.currentTime, options.startAt - 0.02));
    if (options.startSilent && options.fadeInDuration > 0) {
      gain.gain.setValueAtTime(0, options.startAt);
      gain.gain.linearRampToValueAtTime(baseGain, options.startAt + options.fadeInDuration);
    }

    source.connect(gain);
    gain.connect(masterGain);
    source.start(options.startAt, options.offsetSec);
    void this.resumeAudioContext();

    return {
      laneId,
      clipId,
      packId,
      source,
      gain,
      startTime: options.startAt,
      stopTime: null,
    };
  }

  private scheduleStopPlayback(
    playback: ActiveLanePlayback,
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
      playback.gain.gain.cancelScheduledValues(audioContext.currentTime);
      playback.gain.gain.setValueAtTime(playback.gain.gain.value, fadeStart);
      playback.gain.gain.linearRampToValueAtTime(0, fadeEnd);
      playback.source.stop(fadeEnd + 0.05);
      playback.stopTime = fadeEnd + 0.05;
      playback.source.addEventListener(
        'ended',
        () => {
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

  private getNextBarBoundary(
    pack: { bpm: number; beatsPerBar: number },
    currentTime: number,
  ): number {
    const barDuration = this.getBarDuration(pack);
    const elapsed = Math.max(0, currentTime - this.transportStartTime);
    const nextBarIndex = Math.floor(elapsed / barDuration) + 1;
    return this.transportStartTime + nextBarIndex * barDuration;
  }

  private getLoopOffsetAtTime(loopDurationSec: number, atTime: number): number {
    if (loopDurationSec <= 0) {
      return 0;
    }

    const elapsed = Math.max(0, atTime - this.transportStartTime);
    return elapsed % loopDurationSec;
  }

  private async resumeAudioContext(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'running') {
      return;
    }

    try {
      await this.audioContext.resume();
    } catch {
      void 0;
    }
  }
}

export const globalRoomMusicController = new RoomMusicController();

export function initRoomMusic(windowObj: Window = window): void {
  globalRoomMusicController.init(windowObj);
}
