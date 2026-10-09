import { getRoomMusicPack } from './catalog';
import { getRoomMusicBarDurationSec, getRoomMusicLoopDurationSec, type RoomMusic } from './model';

export type MusicTransitionMode = 'immediate' | 'bar' | 'room';

function timingIdentity(music: RoomMusic | null): string | null {
  if (!music) return null;
  if (music.kind === 'stemArrangement') {
    const pack = getRoomMusicPack(music.packId);
    // A stem pack has no authored tonal key; only the same pack is compatible.
    return pack ? `pack:${pack.id}:${pack.bpm}:${pack.beatsPerBar}` : null;
  }
  return `${music.bpm}:${music.beatsPerBar}:${music.swingPercent}:${music.keyTonic}:${music.keyMode}`;
}

export function getMusicTransitionPlan(input: {
  prior: RoomMusic | null;
  next: RoomMusic;
  now: number;
  transportStartTime: number;
  hasPriorPlayback: boolean;
  hasAudiblePlayback: boolean;
  transition: MusicTransitionMode;
  fadeDurationSec?: number;
}): {
  startAt: number;
  stopAt: number;
  fadeDuration: number;
  loopOffset: number;
  transportStartTime: number;
  hasPriorPlayback: boolean;
  quantizeToBar: boolean;
} {
  const barDuration = getRoomMusicBarDurationSec(input.next);
  const loopDuration = getRoomMusicLoopDurationSec(input.next);
  const roomTransition = input.transition === 'room';
  const compatible = timingIdentity(input.prior) !== null && timingIdentity(input.prior) === timingIdentity(input.next);
  const quantizeToBar = barDuration > 0 && input.hasPriorPlayback && (
    input.transition === 'bar' || (roomTransition && compatible && input.hasAudiblePlayback)
  );
  const nextBar = barDuration > 0
    ? input.transportStartTime + (Math.floor(Math.max(0, input.now - input.transportStartTime) / barDuration) + 1) * barDuration
    : input.now;
  const startAt = quantizeToBar ? nextBar : input.now + 0.02;
  const freshDownbeat = !input.hasPriorPlayback || (roomTransition && !quantizeToBar);
  const transportStartTime = freshDownbeat || input.transportStartTime <= 0 ? startAt : input.transportStartTime;
  const loopOffset = freshDownbeat || loopDuration <= 0 ? 0 : Math.max(0, startAt - transportStartTime) % loopDuration;
  return {
    startAt,
    stopAt: quantizeToBar ? startAt : input.now,
    fadeDuration: input.fadeDurationSec ?? (quantizeToBar ? barDuration : roomTransition ? 0.3 : 0.18),
    loopOffset,
    transportStartTime,
    hasPriorPlayback: input.hasPriorPlayback,
    quantizeToBar,
  };
}
