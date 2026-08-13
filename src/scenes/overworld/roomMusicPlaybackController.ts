import type { CourseRoomRef, CourseSnapshot } from '../../courses/model';
import {
  getRoomMusicKey,
  isRoomMusicEmpty,
  type RoomMusic,
} from '../../music/model';
import type {
  RoomCoordinates,
  RoomSnapshotView,
} from '../../persistence/roomModel';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import type { OverworldMode } from '../sceneData';

interface RoomMusicPlaybackTarget {
  identity: string;
  sourceRoomId: string;
  music: RoomSnapshotView['music'];
}

export interface RoomMusicPlaybackCourseRun {
  course: CourseSnapshot;
  expandedRoomId: string | null;
  expandedRoomVersion: number | null;
  startRoomId: string | null;
}

interface OverworldRoomMusicPlaybackHost {
  getRoomSnapshotViewForCoordinates(coordinates: RoomCoordinates): RoomSnapshotView | null;
  getRoomSummaryById(roomId: string): WorldRoomSummary | null;
  getRoomSummaries(): Iterable<WorldRoomSummary>;
  getExpandedRoomIdAt(coordinates: RoomCoordinates): string | null;
  getCourseStartRoomRef(
    course: CourseSnapshot,
    lockedStartRoomId?: string | null,
  ): CourseRoomRef | null;
}

export interface RoomMusicPlaybackPort {
  playArrangement(
    music: RoomMusic,
    options: {
      mode: 'world-play';
      transition: 'bar';
    },
  ): Promise<void> | void;
  stopArrangement(options: {
    transition: 'immediate' | 'bar';
    fadeDurationSec: number;
    mode: 'idle' | 'world-play';
    resetTransport?: boolean;
  }): void;
}

export interface OverworldRoomMusicPlaybackSyncInput {
  mode: OverworldMode;
  currentRoomCoordinates: RoomCoordinates;
  activeCourseRun: RoomMusicPlaybackCourseRun | null;
}

export class OverworldRoomMusicPlaybackController {
  private lastSyncSignature = '';

  constructor(
    private readonly host: OverworldRoomMusicPlaybackHost,
    private readonly playback: RoomMusicPlaybackPort,
  ) {}

  sync(input: OverworldRoomMusicPlaybackSyncInput): void {
    if (input.mode !== 'play') {
      const signature = `mode:${input.mode}`;
      if (this.lastSyncSignature === signature) {
        return;
      }

      this.lastSyncSignature = signature;
      this.stopImmediately();
      return;
    }

    const currentRoom = this.host.getRoomSnapshotViewForCoordinates(
      input.currentRoomCoordinates,
    );
    if (!currentRoom) {
      return;
    }

    const playbackTarget = this.resolvePlaybackTarget(currentRoom, input.activeCourseRun);
    const roomMusicKey = getRoomMusicKey(playbackTarget.music as RoomMusic | null) ?? 'none';
    const signature =
      `mode:play|${playbackTarget.identity}|source:${playbackTarget.sourceRoomId}|music:${roomMusicKey}`;
    if (this.lastSyncSignature === signature) {
      return;
    }

    this.lastSyncSignature = signature;
    if (isRoomMusicEmpty(playbackTarget.music as RoomMusic | null)) {
      this.playback.stopArrangement({
        transition: 'bar',
        fadeDurationSec: 0.18,
        mode: 'world-play',
      });
      return;
    }

    void this.playback.playArrangement(playbackTarget.music as RoomMusic, {
      mode: 'world-play',
      transition: 'bar',
    });
  }

  reset(): void {
    this.lastSyncSignature = '';
    this.stopImmediately();
  }

  stopImmediately(): void {
    this.playback.stopArrangement({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode: 'idle',
      resetTransport: true,
    });
  }

  private resolvePlaybackTarget(
    currentRoom: RoomSnapshotView,
    activeCourseRun: RoomMusicPlaybackCourseRun | null,
  ): RoomMusicPlaybackTarget {
    const activeCourse = activeCourseRun?.course ?? null;
    if (activeCourse?.roomRefs.some((roomRef) => roomRef.roomId === currentRoom.id)) {
      const sourceRoom = this.resolveCourseAreaMusicSource(
        activeCourse,
        currentRoom,
        activeCourseRun?.startRoomId ?? null,
      );
      const expandedRoomId =
        activeCourseRun?.expandedRoomId
        ?? this.host.getExpandedRoomIdAt(currentRoom.coordinates)
        ?? `course:${activeCourse.id}`;
      return {
        identity: `expanded-room:${expandedRoomId}|v:${activeCourseRun?.expandedRoomVersion ?? activeCourse.version}`,
        sourceRoomId: sourceRoom.id,
        music: sourceRoom.music,
      };
    }

    const expandedRoom = this.host.getRoomSummaryById(currentRoom.id)?.expandedRoom ?? null;
    if (expandedRoom && expandedRoom.cellCount > 1) {
      const sourceRoom = this.resolveLoadedExpandedRoomMusicSource(
        expandedRoom.expandedRoomId,
        currentRoom,
      );
      return {
        identity: `expanded-room:${expandedRoom.expandedRoomId}`,
        sourceRoomId: sourceRoom.id,
        music: sourceRoom.music,
      };
    }

    return {
      identity: `room:${currentRoom.id}`,
      sourceRoomId: currentRoom.id,
      music: currentRoom.music,
    };
  }

  private resolveCourseAreaMusicSource(
    course: CourseSnapshot,
    currentRoom: RoomSnapshotView,
    lockedStartRoomId: string | null = null,
  ): RoomSnapshotView {
    const startRoomRef = this.host.getCourseStartRoomRef(course, lockedStartRoomId);
    const orderedRoomRefs = [
      ...(startRoomRef ? [startRoomRef] : []),
      ...course.roomRefs.filter((roomRef) => roomRef.roomId !== startRoomRef?.roomId),
    ];
    let firstAvailableRoom: RoomSnapshotView | null = null;
    for (const roomRef of orderedRoomRefs) {
      const room = this.host.getRoomSnapshotViewForCoordinates(roomRef.coordinates);
      if (!room) {
        continue;
      }
      firstAvailableRoom ??= room;
      if (!isRoomMusicEmpty(room.music as RoomMusic | null)) {
        return room;
      }
    }

    return firstAvailableRoom ?? currentRoom;
  }

  private resolveLoadedExpandedRoomMusicSource(
    expandedRoomId: string,
    currentRoom: RoomSnapshotView,
  ): RoomSnapshotView {
    const candidateCoordinates = Array.from(this.host.getRoomSummaries())
      .filter((summary) => summary.expandedRoom?.expandedRoomId === expandedRoomId)
      .map((summary) => summary.coordinates)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    let firstAvailableRoom: RoomSnapshotView | null = null;
    for (const coordinates of candidateCoordinates) {
      const room = this.host.getRoomSnapshotViewForCoordinates(coordinates);
      if (!room) {
        continue;
      }
      firstAvailableRoom ??= room;
      if (!isRoomMusicEmpty(room.music as RoomMusic | null)) {
        return room;
      }
    }

    return firstAvailableRoom ?? currentRoom;
  }
}
