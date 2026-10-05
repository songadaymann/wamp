import { beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({ openControlsIfNeeded: vi.fn() }));
const fresh = vi.hoisted(() => ({ loadCourse: vi.fn() }));
vi.mock('phaser', () => ({ default: { Math: { Clamp: (n: number) => n } } }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: vi.fn() }));
vi.mock('../../courses/draftSession', () => ({ getActiveCourseDraftSessionRecord: vi.fn() }));
vi.mock('../editorSceneLoader', () => ({ ensureEditorScenesRegistered: vi.fn() }));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => fresh }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({}) }));
vi.mock('../../audio/sfx', () => ({ playSfx: vi.fn() }));
vi.mock('../../navigation/worldNavigation', () => ({ setFocusedCoordinatesInUrl: vi.fn() }));
vi.mock('../../ui/appFeedback', () => ({ showBusyOverlay: vi.fn(), hideBusyOverlay: vi.fn(), showBusyError: vi.fn() }));
vi.mock('../../ui/setup/roomGoalIntroModal', () => ({ getRoomGoalIntroModalController: () => controls }));

import { OverworldSceneFlowController } from './flow';

beforeEach(() => { controls.openControlsIfNeeded.mockReset(); fresh.loadCourse.mockReset(); });

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

  it('rejects a prompt assembly changed while its controls were open', async () => {
    const f = fixture(); const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await f.controller.playSelectedCourse(2, () => true); f.start();
    await vi.waitFor(() => expect(fresh.loadCourse).toHaveBeenCalledWith('chosen-course'));
    expect(f.load).not.toHaveBeenCalled();
    expect(f.playback).not.toHaveBeenCalled(); error.mockRestore();
  });
  it('does not start a stopped prompt sequence after the delayed controls continuation', async () => {
    const f = fixture(); let current = true;
    await f.controller.playSelectedCourse(1, () => current); current = false; f.start();
    await vi.waitFor(() => expect(fresh.loadCourse).toHaveBeenCalledWith('chosen-course')); expect(f.playback).not.toHaveBeenCalled();
  });
  it('plays the newly entered publication even when the scene has an older cached assembly', async () => {
    const f = fixture(); const published = { ...f.snapshot, version: 2 };
    fresh.loadCourse.mockResolvedValue({ published });
    controls.openControlsIfNeeded.mockReturnValue(false);
    await f.controller.playSelectedCourse(2, () => true);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.playback).toHaveBeenCalledWith(published, 'published', expect.any(Function));
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
  const snapshot = { id: 'chosen-course', version: 1, goal: { type: 'reach_exit' } };
  fresh.loadCourse.mockResolvedValue({ published: snapshot });
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
