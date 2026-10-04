import { beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({ openControlsIfNeeded: vi.fn() }));
vi.mock('phaser', () => ({ default: { Math: { Clamp: (n: number) => n } } }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: vi.fn() }));
vi.mock('../../courses/draftSession', () => ({ getActiveCourseDraftSessionRecord: vi.fn() }));
vi.mock('../editorSceneLoader', () => ({ ensureEditorScenesRegistered: vi.fn() }));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => ({}) }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({}) }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));
vi.mock('../../navigation/worldNavigation', () => ({ setFocusedCoordinatesInUrl: vi.fn() }));
vi.mock('../../ui/appFeedback', () => ({ showBusyOverlay: vi.fn(), hideBusyOverlay: vi.fn(), showBusyError: vi.fn() }));
vi.mock('../../ui/setup/roomGoalIntroModal', () => ({ getRoomGoalIntroModalController: () => controls }));

import { OverworldSceneFlowController } from './flow';

beforeEach(() => { controls.openControlsIfNeeded.mockReset(); });

describe('expanded room controls continuation', () => {
  it('holds playback until Start and retains the chosen course when streamed HUD context disappears', async () => {
    const f = fixture();
    await f.controller.playSelectedCourse();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.playback).not.toHaveBeenCalled();
    f.dropCourseContext();
    f.start();
    await vi.waitFor(() => expect(f.playback).toHaveBeenCalledWith(f.snapshot, 'published'));
    expect(f.load).toHaveBeenCalledWith('chosen-course');
  });

  it.each(['selection', 'mode'] as const)('does not resume an abandoned %s after Start', async change => {
    const f = fixture();
    await f.controller.playSelectedCourse();
    f.change(change);
    f.start();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.playback).not.toHaveBeenCalled();
  });

  it('starts an acknowledged input without another guide', async () => {
    const f = fixture();
    controls.openControlsIfNeeded.mockReturnValue(false);
    await f.controller.playSelectedCourse();
    expect(f.load).toHaveBeenCalledWith('chosen-course');
    expect(f.playback).toHaveBeenCalledWith(f.snapshot, 'published');
  });
});

function fixture() {
  let courseId: string | null = 'chosen-course';
  let mode: 'browse' | 'play' = 'browse';
  let coordinates = { x: 4, y: 2 };
  let pendingStart: (() => void) | null = null;
  controls.openControlsIfNeeded.mockImplementation((onStart: () => void) => { pendingStart = onStart; return true; });
  const snapshot = { id: 'chosen-course', goal: { type: 'reach_exit' } };
  const load = vi.fn(async () => snapshot);
  const controller = new OverworldSceneFlowController({ game: {} } as never, {
    getMode: () => mode,
    getActiveCourseRun: () => null,
    getSelectedCoordinates: () => ({ ...coordinates }),
    getSelectedPublishedCourseId: () => courseId,
    loadPublishedCourseSnapshot: load,
  } as never);
  const playback = vi.spyOn(controller, 'startCoursePlayback').mockResolvedValue();
  return {
    controller, load, playback, snapshot,
    dropCourseContext: () => { courseId = null; },
    change: (kind: 'selection' | 'mode') => { if (kind === 'mode') mode = 'play'; else coordinates = { x: 5, y: 2 }; },
    start: () => { controls.openControlsIfNeeded.mockReturnValue(false); pendingStart?.(); },
  };
}
