import Phaser from 'phaser';
import { playSfx, type SfxCue, type SfxPlaybackOptions } from '../../audio/sfx';
import type { RoomCoordinates } from '../../persistence/roomModel';
import type { OverworldMode } from '../sceneData';

interface OverworldRoomAudioControllerOptions {
  scene: Phaser.Scene;
  getMode: () => OverworldMode;
  getCurrentRoomCoordinates: () => RoomCoordinates;
}

interface RoomAudioDebugSnapshot {
  lastCue: SfxCue | null;
  lastSourceRoom: RoomCoordinates | null;
  lastDistance: number | null;
  lastRoute: 'default' | 'adjacent-bleed' | 'ignored' | null;
  pendingEchoCount: number;
}

const ADJACENT_ROOM_PRIMARY_PLAYBACK: SfxPlaybackOptions = {
  volumeMultiplier: 0.34,
  playbackRateMultiplier: 0.95,
};

const ADJACENT_ROOM_ECHO_PLAYBACKS: Array<{
  delayMs: number;
  playback: SfxPlaybackOptions;
}> = [
  {
    delayMs: 110,
    playback: {
      volumeMultiplier: 0.14,
      playbackRateMultiplier: 0.88,
      ignoreCooldown: true,
    },
  },
  {
    delayMs: 210,
    playback: {
      volumeMultiplier: 0.08,
      playbackRateMultiplier: 0.82,
      ignoreCooldown: true,
    },
  },
];

export class OverworldRoomAudioController {
  private readonly pendingEchoTimers = new Set<Phaser.Time.TimerEvent>();
  private lastCue: SfxCue | null = null;
  private lastSourceRoom: RoomCoordinates | null = null;
  private lastDistance: number | null = null;
  private lastRoute: 'default' | 'adjacent-bleed' | 'ignored' | null = null;

  constructor(private readonly options: OverworldRoomAudioControllerOptions) {}

  destroy(): void {
    for (const timer of this.pendingEchoTimers) {
      timer.remove(false);
    }
    this.pendingEchoTimers.clear();
  }

  getPlaybackOptionsForRoom(sourceRoom: RoomCoordinates): SfxPlaybackOptions | null | undefined {
    const route = this.getRouteForRoom(sourceRoom);
    if (route === 'adjacent-bleed') {
      return ADJACENT_ROOM_PRIMARY_PLAYBACK;
    }
    if (route === 'ignored') {
      return null;
    }
    return undefined;
  }

  playRoomSfx(cue: SfxCue, sourceRoom: RoomCoordinates): void {
    const route = this.getRouteForRoom(sourceRoom);
    this.record(cue, sourceRoom, route);

    if (route === 'ignored') {
      return;
    }

    if (route === 'adjacent-bleed') {
      playSfx(cue, ADJACENT_ROOM_PRIMARY_PLAYBACK);
      for (const echo of ADJACENT_ROOM_ECHO_PLAYBACKS) {
        this.scheduleEcho(cue, echo.delayMs, echo.playback);
      }
      return;
    }

    playSfx(cue);
  }

  getDebugSnapshot(): RoomAudioDebugSnapshot {
    return {
      lastCue: this.lastCue,
      lastSourceRoom: this.lastSourceRoom ? { ...this.lastSourceRoom } : null,
      lastDistance: this.lastDistance,
      lastRoute: this.lastRoute,
      pendingEchoCount: this.pendingEchoTimers.size,
    };
  }

  private scheduleEcho(cue: SfxCue, delayMs: number, playback: SfxPlaybackOptions): void {
    const timer = this.options.scene.time.delayedCall(delayMs, () => {
      this.pendingEchoTimers.delete(timer);
      playSfx(cue, playback);
    });
    this.pendingEchoTimers.add(timer);
  }

  private getRouteForRoom(
    sourceRoom: RoomCoordinates
  ): 'default' | 'adjacent-bleed' | 'ignored' {
    if (this.options.getMode() !== 'play') {
      return 'default';
    }

    const currentRoom = this.options.getCurrentRoomCoordinates();
    const distance =
      Math.abs(currentRoom.x - sourceRoom.x) + Math.abs(currentRoom.y - sourceRoom.y);
    if (distance <= 0) {
      return 'default';
    }
    if (distance === 1) {
      return 'adjacent-bleed';
    }
    return 'ignored';
  }

  private record(
    cue: SfxCue,
    sourceRoom: RoomCoordinates,
    route: 'default' | 'adjacent-bleed' | 'ignored'
  ): void {
    const currentRoom = this.options.getCurrentRoomCoordinates();
    this.lastCue = cue;
    this.lastSourceRoom = { ...sourceRoom };
    this.lastDistance =
      Math.abs(currentRoom.x - sourceRoom.x) + Math.abs(currentRoom.y - sourceRoom.y);
    this.lastRoute = route;
  }
}
