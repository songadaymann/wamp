import { describe, expect, it } from 'vitest';
import {
  cloneCourseSnapshot,
  createDefaultCourseGoal,
  createDefaultCourseRecord,
  type CourseRecord,
} from '../model';
import { buildCourseEditorUiState } from './viewModel';

function createCompleteRecord(): CourseRecord {
  const record = createDefaultCourseRecord('expanded-room-1');
  record.draft.title = 'Two Cell Trial';
  record.draft.roomRefs = [
    {
      roomId: '4,2',
      coordinates: { x: 4, y: 2 },
      roomVersion: 7,
      roomTitle: 'Start',
    },
    {
      roomId: '5,2',
      coordinates: { x: 5, y: 2 },
      roomVersion: 3,
      roomTitle: 'Finish',
    },
  ];
  record.draft.startPoint = { roomId: '4,2', x: 24, y: 320 };
  const goal = createDefaultCourseGoal('reach_exit');
  if (goal.type !== 'reach_exit') {
    throw new Error('Expected a reach-exit goal fixture.');
  }
  goal.exit = { roomId: '5,2', x: 600, y: 320 };
  record.draft.goal = goal;

  record.published = cloneCourseSnapshot(record.draft);
  record.published.version = 4;
  record.published.status = 'published';
  return record;
}

function buildState(record: CourseRecord, dirty: boolean) {
  return buildCourseEditorUiState({
    record,
    dirty,
    zoomText: '100%',
    tool: 'select',
    statusText: 'Expanded room ready.',
    selectedRoomSummary: 'Start · 4,2',
    selectedRoomStatusText: 'Cell is already included.',
    selectedRoomId: '4,2',
    canToggleSelectedRoom: true,
    toggleSelectedRoomLabel: 'Remove Cell',
    toggleSelectedRoomDisabledReason: null,
    canOpenSelectedRoom: true,
    canCenterSelectedRoom: true,
    canOpenCourseEditor: true,
    openCourseEditorDisabledReason: null,
    roomEntries: record.draft.roomRefs.map((roomRef, index) => ({
      ...roomRef,
      selected: index === 0,
      isStartRoom: index === 0,
      isFinishRoom: index === 1,
      checkpointIndexes: [],
    })),
    checkpointEntries: [],
  });
}

describe('active expanded-room composer view model', () => {
  it('preserves editable title, cells, goal, dirty, and publish presentation', () => {
    const record = createCompleteRecord();
    const state = buildState(record, true);

    expect(state).toMatchObject({
      visible: true,
      title: 'Two Cell Trial',
      canEdit: true,
      dirty: true,
      goalType: 'reach_exit',
      publishedStateText: 'Published v4 live · draft has unpublished changes',
      cellUsageText: '2/16 cells used · 14 cells remaining',
      canTestDraft: true,
      canSaveDraft: true,
      canPublishCourse: true,
      showUnpublishCourse: true,
      canUnpublishCourse: true,
    });
    expect(state.roomEntries.map((entry) => entry.roomId)).toEqual(['4,2', '5,2']);
    expect(state.summaryText).toBe(
      '2/16 cells used · 14 cells remaining · Reach Exit · start set · exit set',
    );
  });

  it('preserves the complete read-only disable contract', () => {
    const record = createCompleteRecord();
    record.permissions = {
      canSaveDraft: false,
      canPublish: false,
      canUnpublish: false,
    };

    const state = buildState(record, false);

    expect(state.canEdit).toBe(false);
    expect(state.canTestDraft).toBe(false);
    expect(state.testDraftDisabledReason).toBe(
      'This expanded room is read-only for your account.',
    );
    expect(state.canSaveDraft).toBe(false);
    expect(state.saveDraftDisabledReason).toBe(
      'This expanded room is read-only for your account.',
    );
    expect(state.canPublishCourse).toBe(false);
    expect(state.publishCourseDisabledReason).toBe(
      'This expanded room is read-only for your account.',
    );
    expect(state.canUnpublishCourse).toBe(false);
    expect(state.unpublishCourseDisabledReason).toBe(
      'This expanded room is read-only for your account.',
    );
  });
});
