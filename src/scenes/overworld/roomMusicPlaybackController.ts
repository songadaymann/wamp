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
  sourceRevision: string;
}

interface RoomMusicMetadata {
  revision: string;
  key: string | null;
  empty: boolean;
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
  getRoomSummariesRevision(): number;
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
  private lastMode: OverworldMode | null = null;
  private lastPlayback: { identity: string; sourceRoomId: string; musicKey: string | null } | null = null;
  private musicMetadata = new WeakMap<NonNullable<RoomSnapshotView['music']>, RoomMusicMetadata>();
  private expandedCandidates: {
    id: string;
    revision: number;
    coordinates: RoomCoordinates[];
  } | null = null;

  constructor(
    private readonly host: OverworldRoomMusicPlaybackHost,
    private readonly playback: RoomMusicPlaybackPort,
  ) {}

  sync(input: OverworldRoomMusicPlaybackSyncInput): void {
    if (input.mode !== 'play') {
      if (this.lastMode === input.mode) {
        return;
      }

      this.lastMode = input.mode;
      this.lastPlayback = null;
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
    const metadata = this.getMusicMetadata(playbackTarget.music, playbackTarget.sourceRevision);
    if (
      this.lastMode === 'play'
      && this.lastPlayback?.identity === playbackTarget.identity
      && this.lastPlayback.sourceRoomId === playbackTarget.sourceRoomId
      && this.lastPlayback.musicKey === metadata.key
    ) {
      return;
    }

    this.lastMode = 'play';
    this.lastPlayback = {
      identity: playbackTarget.identity,
      sourceRoomId: playbackTarget.sourceRoomId,
      musicKey: metadata.key,
    };
    if (metadata.empty) {
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
    this.lastMode = null;
    this.lastPlayback = null;
    this.musicMetadata = new WeakMap();
    this.expandedCandidates = null;
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
        sourceRevision: this.getSourceRevision(sourceRoom),
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
        sourceRevision: this.getSourceRevision(sourceRoom),
      };
    }

    return {
      identity: `room:${currentRoom.id}`,
      sourceRoomId: currentRoom.id,
      music: currentRoom.music,
      sourceRevision: this.getSourceRevision(currentRoom),
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
      if (!this.getMusicMetadata(room.music, this.getSourceRevision(room)).empty) {
        return room;
      }
    }

    return firstAvailableRoom ?? currentRoom;
  }

  private resolveLoadedExpandedRoomMusicSource(
    expandedRoomId: string,
    currentRoom: RoomSnapshotView,
  ): RoomSnapshotView {
    const revision = this.host.getRoomSummariesRevision();
    if (this.expandedCandidates?.id !== expandedRoomId || this.expandedCandidates.revision !== revision) {
      this.expandedCandidates = {
        id: expandedRoomId,
        revision,
        coordinates: Array.from(this.host.getRoomSummaries())
          .filter((summary) => summary.expandedRoom?.expandedRoomId === expandedRoomId)
          .map((summary) => ({ ...summary.coordinates }))
          .sort((a, b) => a.y - b.y || a.x - b.x),
      };
    }
    let firstAvailableRoom: RoomSnapshotView | null = null;
    // Recheck availability in order: an earlier source can hydrate after a
    // later one started playing, without changing the world summaries.
    for (const coordinates of this.expandedCandidates.coordinates) {
      const room = this.host.getRoomSnapshotViewForCoordinates(coordinates);
      if (!room) {
        continue;
      }
      firstAvailableRoom ??= room;
      if (!this.getMusicMetadata(room.music, this.getSourceRevision(room)).empty) {
        return room;
      }
    }

    return firstAvailableRoom ?? currentRoom;
  }

  private getSourceRevision(room: RoomSnapshotView): string {
    return `${room.version}:${room.updatedAt}`;
  }

  private getMusicMetadata(
    music: RoomSnapshotView['music'],
    revision: string,
  ): RoomMusicMetadata {
    if (!music) return { revision, key: null, empty: true };
    const cached = this.musicMetadata.get(music);
    if (cached?.revision === revision) return cached;
    // Runtime snapshots are readonly; editors replace music or publish a new
    // revision. Weak keys let released snapshots leave the cache naturally.
    const metadata = {
      revision,
      key: getRoomMusicKey(music as RoomMusic),
      empty: isRoomMusicEmpty(music as RoomMusic),
    };
    this.musicMetadata.set(music, metadata);
    return metadata;
  }
}
