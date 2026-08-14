import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { TUTORIAL_TEMPLATE_VERSIONS } from '../../tutorial/config';
import { createEmptyCreativeChecklist } from '../../tutorial/model';
import { buildEditorPlayModeData } from './playMode';

describe('buildEditorPlayModeData tutorial context', () => {
  it('keeps the room private and propagates context through the return target', () => {
    const room = createDefaultRoomSnapshot('-10,-6', { x: -10, y: -6 });
    room.status = 'draft';
    const context = {
      sessionId: 'tutorial-session',
      stage: 'bridge_playtest' as const,
      mode: 'private_playtest' as const,
      private: true,
      inputLocked: false,
      templateVersions: { ...TUTORIAL_TEMPLATE_VERSIONS },
      checklist: createEmptyCreativeChecklist(),
    };

    const data = buildEditorPlayModeData({
      roomCoordinates: room.coordinates,
      roomSnapshot: room,
      usePublishedCourseRoomVersion: true,
      coursePreview: null,
      courseEditedRoom: null,
      tutorialContext: context,
    });

    expect(data.draftRoom).toEqual(room);
    expect(data.publishedRoom).toBeNull();
    expect(data.tutorialContext).toEqual(context);
    expect(data.editorPlaytestReturnTarget?.tutorialContext).toEqual(context);
    expect(data.editorPlaytestReturnTarget?.tutorialContext).not.toBe(context);
  });
});
