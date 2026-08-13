import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultCourseSnapshot,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../courses/model';
import {
  createDefaultRoomMusic,
  type RoomMusic,
} from '../../music/model';
import {
  createDefaultRoomSnapshot,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from '../../persistence/roomModel';
import type { WorldRoomSummary } from '../../persistence/worldModel';
import {
  OverworldRoomMusicPlaybackController,
  type RoomMusicPlaybackCourseRun,
  type RoomMusicPlaybackPort,
} from './roomMusicPlaybackController';

function createMusic(clipId: string): RoomMusic {
  const music = createDefaultRoomMusic();
  music.arrangement.laneAssignments.drums[0] = clipId;
  return music;
}

function createRoom(
  coordinates: RoomCoordinates,
  music: RoomMusic | null,
): RoomSnapshot {
  const room = createDefaultRoomSnapshot(roomIdFromCoordinates(coordinates), coordinates);
  room.music = music;
  return room;
}

function createSummary(
  room: RoomSnapshot,
  expandedRoomId: string | null = null,
  cellCount = 1,
): WorldRoomSummary {
  return {
    id: room.id,
    coordinates: { ...room.coordinates },
    title: room.title,
    state: 'published',
    background: room.background,
    goalType: room.goal?.type ?? null,
    version: room.version,
    publishedAt: room.publishedAt,
    previewUpdatedAt: room.updatedAt,
    creatorUserId: null,
    creatorDisplayName: null,
    publishedByUserId: null,
    publishedByDisplayName: null,
    course: null,
    expandedRoom: expandedRoomId
      ? {
          expandedRoomId,
          title: null,
          goalType: null,
          cellCount,
          source: 'native_expanded_room',
          legacyCourseId: null,
        }
      : null,
  };
}

function createCourse(roomRefs: CourseRoomRef[], version = 3): CourseSnapshot {
  const course = createDefaultCourseSnapshot('course-1');
  course.roomRefs = roomRefs;
  course.version = version;
  course.status = 'published';
  return course;
}

function createRoomRef(room: RoomSnapshot): CourseRoomRef {
  return {
    roomId: room.id,
    coordinates: { ...room.coordinates },
    roomVersion: room.version,
    roomTitle: room.title,
  };
}

function createCourseRun(
  course: CourseSnapshot,
  options: Partial<Omit<RoomMusicPlaybackCourseRun, 'course'>> = {},
): RoomMusicPlaybackCourseRun {
  return {
    course,
    expandedRoomId: options.expandedRoomId ?? null,
    expandedRoomVersion: options.expandedRoomVersion ?? null,
    startRoomId: options.startRoomId ?? null,
  };
}

function createHarness(options: {
  rooms?: RoomSnapshot[];
  summaries?: WorldRoomSummary[];
  expandedRoomIdAt?: string | null;
  courseStartRoomId?: string | null;
} = {}) {
  const roomsById = new Map((options.rooms ?? []).map((room) => [room.id, room]));
  const summaries = options.summaries ?? [];
  const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
  const playArrangement = vi.fn<RoomMusicPlaybackPort['playArrangement']>();
  const stopArrangement = vi.fn<RoomMusicPlaybackPort['stopArrangement']>();
  const getCourseStartRoomRef = vi.fn(
    (course: CourseSnapshot, lockedStartRoomId: string | null = null) => {
      const startRoomId = options.courseStartRoomId ?? lockedStartRoomId;
      return course.roomRefs.find((roomRef) => roomRef.roomId === startRoomId)
        ?? course.roomRefs[0]
        ?? null;
    },
  );
  const controller = new OverworldRoomMusicPlaybackController(
    {
      getRoomSnapshotViewForCoordinates: (coordinates) =>
        roomsById.get(roomIdFromCoordinates(coordinates)) ?? null,
      getRoomSummaryById: (roomId) => summariesById.get(roomId) ?? null,
      getRoomSummaries: () => summaries,
      getExpandedRoomIdAt: () => options.expandedRoomIdAt ?? null,
      getCourseStartRoomRef,
    },
    {
      playArrangement,
      stopArrangement,
    },
  );

  return {
    controller,
    getCourseStartRoomRef,
    playArrangement,
    roomsById,
    stopArrangement,
  };
}

describe('OverworldRoomMusicPlaybackController', () => {
  it('plays ordinary room music with the existing bar transition and deduplicates its signature', () => {
    const music = createMusic('drums-1');
    const room = createRoom({ x: 2, y: -1 }, music);
    const { controller, playArrangement, stopArrangement } = createHarness({ rooms: [room] });
    const input = {
      mode: 'play' as const,
      currentRoomCoordinates: room.coordinates,
      activeCourseRun: null,
    };

    controller.sync(input);
    controller.sync(input);

    expect(playArrangement).toHaveBeenCalledOnce();
    expect(playArrangement).toHaveBeenCalledWith(music, {
      mode: 'world-play',
      transition: 'bar',
    });
    expect(stopArrangement).not.toHaveBeenCalled();
  });

  it('stops an empty room on the existing bar transition and deduplicates the stop', () => {
    const room = createRoom({ x: 0, y: 0 }, null);
    const { controller, playArrangement, stopArrangement } = createHarness({ rooms: [room] });
    const input = {
      mode: 'play' as const,
      currentRoomCoordinates: room.coordinates,
      activeCourseRun: null,
    };

    controller.sync(input);
    controller.sync(input);

    expect(playArrangement).not.toHaveBeenCalled();
    expect(stopArrangement).toHaveBeenCalledOnce();
    expect(stopArrangement).toHaveBeenCalledWith({
      transition: 'bar',
      fadeDurationSec: 0.18,
      mode: 'world-play',
    });
  });

  it('stops immediately once on mode exit and resets transport with the existing timing', () => {
    const { controller, stopArrangement } = createHarness();

    controller.sync({
      mode: 'browse',
      currentRoomCoordinates: { x: 0, y: 0 },
      activeCourseRun: null,
    });
    controller.sync({
      mode: 'browse',
      currentRoomCoordinates: { x: 4, y: 7 },
      activeCourseRun: null,
    });

    expect(stopArrangement).toHaveBeenCalledOnce();
    expect(stopArrangement).toHaveBeenLastCalledWith({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode: 'idle',
      resetTransport: true,
    });

    controller.reset();
    expect(stopArrangement).toHaveBeenCalledTimes(2);
    expect(stopArrangement).toHaveBeenLastCalledWith({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode: 'idle',
      resetTransport: true,
    });
  });

  it('leaves playback unchanged when the current play room is unavailable', () => {
    const room = createRoom({ x: 1, y: 0 }, createMusic('drums-1'));
    const { controller, playArrangement, roomsById, stopArrangement } = createHarness({
      rooms: [room],
    });

    controller.sync({
      mode: 'play',
      currentRoomCoordinates: room.coordinates,
      activeCourseRun: null,
    });
    roomsById.clear();
    controller.sync({
      mode: 'play',
      currentRoomCoordinates: room.coordinates,
      activeCourseRun: null,
    });

    expect(playArrangement).toHaveBeenCalledOnce();
    expect(stopArrangement).not.toHaveBeenCalled();
  });

  it('uses the locked course start room as the first music source', () => {
    const currentRoom = createRoom({ x: 1, y: 0 }, createMusic('drums-1'));
    const startRoomMusic = createMusic('bass-1');
    const startRoom = createRoom({ x: 0, y: 0 }, startRoomMusic);
    const course = createCourse([createRoomRef(currentRoom), createRoomRef(startRoom)], 5);
    const activeCourseRun = createCourseRun(course, {
      expandedRoomId: 'expanded-course-1',
      expandedRoomVersion: 8,
      startRoomId: startRoom.id,
    });
    const { controller, getCourseStartRoomRef, playArrangement } = createHarness({
      rooms: [currentRoom, startRoom],
    });

    controller.sync({
      mode: 'play',
      currentRoomCoordinates: currentRoom.coordinates,
      activeCourseRun,
    });

    expect(getCourseStartRoomRef).toHaveBeenCalledWith(course, startRoom.id);
    expect(playArrangement).toHaveBeenCalledWith(startRoomMusic, {
      mode: 'world-play',
      transition: 'bar',
    });

    controller.sync({
      mode: 'play',
      currentRoomCoordinates: currentRoom.coordinates,
      activeCourseRun: {
        ...activeCourseRun,
        expandedRoomVersion: 9,
      },
    });
    expect(playArrangement).toHaveBeenCalledTimes(2);
  });

  it('uses the first available non-empty course room after an empty start room', () => {
    const startRoom = createRoom({ x: 0, y: 0 }, null);
    const missingRoom = createRoom({ x: 1, y: 0 }, createMusic('drums-1'));
    const fallbackMusic = createMusic('melody-1');
    const fallbackRoom = createRoom({ x: 2, y: 0 }, fallbackMusic);
    const course = createCourse([
      createRoomRef(startRoom),
      createRoomRef(missingRoom),
      createRoomRef(fallbackRoom),
    ]);
    const { controller, playArrangement } = createHarness({
      rooms: [startRoom, fallbackRoom],
      expandedRoomIdAt: 'expanded-membership-1',
    });

    controller.sync({
      mode: 'play',
      currentRoomCoordinates: fallbackRoom.coordinates,
      activeCourseRun: createCourseRun(course, { startRoomId: startRoom.id }),
    });

    expect(playArrangement).toHaveBeenCalledWith(fallbackMusic, {
      mode: 'world-play',
      transition: 'bar',
    });
  });

  it('falls back to the first available course room when every course room is empty', () => {
    const currentRoom = createRoom({ x: 2, y: 0 }, null);
    const startRoom = createRoom({ x: 0, y: 0 }, null);
    const course = createCourse([createRoomRef(currentRoom), createRoomRef(startRoom)]);
    const { controller, stopArrangement } = createHarness({
      rooms: [currentRoom, startRoom],
      courseStartRoomId: startRoom.id,
    });

    controller.sync({
      mode: 'play',
      currentRoomCoordinates: currentRoom.coordinates,
      activeCourseRun: createCourseRun(course),
    });

    expect(stopArrangement).toHaveBeenCalledWith({
      transition: 'bar',
      fadeDurationSec: 0.18,
      mode: 'world-play',
    });
  });

  it('selects expanded-room music by y-then-x coordinate order', () => {
    const expandedRoomId = 'expanded-1';
    const currentRoom = createRoom({ x: 2, y: 0 }, createMusic('drums-1'));
    const firstMusic = createMusic('arp-1');
    const firstRoom = createRoom({ x: 3, y: -1 }, firstMusic);
    const laterRoom = createRoom({ x: -4, y: 1 }, createMusic('hold-1'));
    const summaries = [currentRoom, laterRoom, firstRoom].map((room) =>
      createSummary(room, expandedRoomId, 3),
    );
    const { controller, playArrangement } = createHarness({
      rooms: [currentRoom, firstRoom, laterRoom],
      summaries,
    });

    controller.sync({
      mode: 'play',
      currentRoomCoordinates: currentRoom.coordinates,
      activeCourseRun: null,
    });

    expect(playArrangement).toHaveBeenCalledWith(firstMusic, {
      mode: 'world-play',
      transition: 'bar',
    });
  });

  it('does not restart playback when crossing cells within the same expanded room', () => {
    const expandedRoomId = 'expanded-cross-cell';
    const sourceMusic = createMusic('bass-2');
    const sourceRoom = createRoom({ x: 0, y: 0 }, sourceMusic);
    const adjacentRoom = createRoom({ x: 1, y: 0 }, createMusic('melody-2'));
    const summaries = [sourceRoom, adjacentRoom].map((room) =>
      createSummary(room, expandedRoomId, 2),
    );
    const { controller, playArrangement } = createHarness({
      rooms: [sourceRoom, adjacentRoom],
      summaries,
    });

    controller.sync({
      mode: 'play',
      currentRoomCoordinates: sourceRoom.coordinates,
      activeCourseRun: null,
    });
    controller.sync({
      mode: 'play',
      currentRoomCoordinates: adjacentRoom.coordinates,
      activeCourseRun: null,
    });

    expect(playArrangement).toHaveBeenCalledOnce();
    expect(playArrangement).toHaveBeenCalledWith(sourceMusic, {
      mode: 'world-play',
      transition: 'bar',
    });
  });

  it('treats single-cell expanded-room metadata as ordinary room playback', () => {
    const currentMusic = createMusic('drums-1');
    const currentRoom = createRoom({ x: 2, y: 0 }, currentMusic);
    const otherRoom = createRoom({ x: 1, y: -1 }, createMusic('arp-1'));
    const summaries = [currentRoom, otherRoom].map((room) =>
      createSummary(room, 'standalone-room', 1),
    );
    const { controller, playArrangement } = createHarness({
      rooms: [currentRoom, otherRoom],
      summaries,
    });

    controller.sync({
      mode: 'play',
      currentRoomCoordinates: currentRoom.coordinates,
      activeCourseRun: null,
    });

    expect(playArrangement).toHaveBeenCalledWith(currentMusic, {
      mode: 'world-play',
      transition: 'bar',
    });
  });
});
