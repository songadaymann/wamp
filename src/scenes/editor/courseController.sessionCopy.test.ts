import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { createDefaultCourseRecord } from '../../courses/model';
import {
  clearActiveCourseDraftSession,
  getActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionRoomOverrideBase,
  isActiveCourseDraftSessionRoomUnsaved,
  setActiveCourseDraftSessionRecord,
} from '../../courses/draftSession';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { buildEditorPlayModeData } from './playMode';
import { EditorCourseController } from './courseController';

vi.mock('phaser', () => ({ default: {} }));

const BASE = '2026-10-22T10:00:00.000Z';

function controllerForCell() {
  const record = createDefaultCourseRecord();
  record.draft.roomRefs = [{ roomId: '3,4', coordinates: { x: 3, y: 4 }, roomVersion: 1, roomTitle: null }];
  setActiveCourseDraftSessionRecord(record);
  const controller = new EditorCourseController({} as Phaser.Scene, {
    getRoomId: () => '3,4', updateGoalUi: () => {}, clearRoomGoalPlacementMode: () => {},
  });
  controller.initialize({ courseId: record.draft.id, roomId: '3,4' });
  return controller;
}

beforeEach(() => clearActiveCourseDraftSession());

describe('room editor session copies of Expanded Room cells (F379)', () => {
  it('keeps the server version the room editor edited from and whether the copy holds unsaved edits', () => {
    const controller = controllerForCell();
    const room = { ...createDefaultRoomSnapshot('3,4', { x: 3, y: 4 }), title: 'Edited in the room editor' };
    controller.syncActiveCourseRoomSessionSnapshot(room, { published: false, baseUpdatedAt: BASE, unsaved: true });
    expect(getActiveCourseDraftSessionRoomOverride('3,4')?.title).toBe('Edited in the room editor');
    expect(getActiveCourseDraftSessionRoomOverrideBase('3,4')).toBe(BASE);
    expect(isActiveCourseDraftSessionRoomUnsaved('3,4')).toBe(true);

    // After the room editor saves, the copy is the saved draft at its new version.
    controller.syncActiveCourseRoomSessionSnapshot(room, { published: false, baseUpdatedAt: '2026-10-22T11:00:00.000Z', unsaved: false });
    expect(getActiveCourseDraftSessionRoomOverrideBase('3,4')).toBe('2026-10-22T11:00:00.000Z');
    expect(isActiveCourseDraftSessionRoomUnsaved('3,4')).toBe(false);
  });

  it('carries the base with a play test so the return to the overworld keeps it', () => {
    const room = createDefaultRoomSnapshot('3,4', { x: 3, y: 4 });
    const data = buildEditorPlayModeData({
      roomCoordinates: room.coordinates, roomSnapshot: room, usePublishedCourseRoomVersion: false,
      coursePreview: null, courseEditedRoom: { courseId: 'course', roomId: '3,4' }, draftBaseUpdatedAt: BASE,
    });
    expect(data.draftRoomBaseUpdatedAt).toBe(BASE);
  });
});
