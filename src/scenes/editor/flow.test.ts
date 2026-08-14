import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  hideBusyOverlay,
  showBusyError,
  showBusyOverlay,
} = vi.hoisted(() => ({
  hideBusyOverlay: vi.fn(),
  showBusyError: vi.fn(),
  showBusyOverlay: vi.fn(),
}));

vi.mock('../../auth/client', () => ({
  getAuthDebugState: vi.fn(() => ({ authenticated: true })),
  promptForSignIn: vi.fn(),
}));

vi.mock('../../ui/appFeedback', () => ({
  hideBusyOverlay,
  showBusyError,
  showBusyOverlay,
}));

import { EditorSceneFlowController } from './flow';

describe('editor return flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the busy overlay after stopping the editor and before waking the course builder', async () => {
    const { controller, host, roomSession, wakeData, courseWakeData } = createHarness({
      returnToCourseEditor: true,
      activeCourseEdit: true,
    });

    await controller.returnToCourseBuilder();

    expect(showBusyOverlay).toHaveBeenCalledWith('Returning to world...', 'Saving room state...');
    expect(roomSession.buildReturnToWorldWakeData).toHaveBeenCalledOnce();
    expect(host.stopEditorScene).toHaveBeenCalledOnce();
    expect(hideBusyOverlay).toHaveBeenCalledOnce();
    expect(host.buildCourseEditorWakeData).toHaveBeenCalledWith({
      ...wakeData,
      courseEditorReturned: true,
      courseEditedRoom: { courseId: 'course-1', roomId: '3,4' },
    });
    expect(host.wakeCourseComposer).toHaveBeenCalledWith(courseWakeData);
    expect(host.wakeOverworld).not.toHaveBeenCalled();
    expect(host.stopEditorScene.mock.invocationCallOrder[0]).toBeLessThan(
      hideBusyOverlay.mock.invocationCallOrder[0],
    );
    expect(hideBusyOverlay.mock.invocationCallOrder[0]).toBeLessThan(
      host.wakeCourseComposer.mock.invocationCallOrder[0],
    );
  });

  it('retains the busy error overlay when return data cannot be built', async () => {
    const { controller, host, roomSession } = createHarness({ returnFailure: true });

    await controller.returnToWorld();

    expect(showBusyOverlay).toHaveBeenCalledWith('Returning to world...', 'Saving room state...');
    expect(roomSession.buildReturnToWorldWakeData).toHaveBeenCalledOnce();
    expect(showBusyError).toHaveBeenCalledWith('Room save failed.', {
      closeHandler: expect.any(Function),
    });
    expect(hideBusyOverlay).not.toHaveBeenCalled();
    expect(host.stopEditorScene).not.toHaveBeenCalled();
    expect(host.wakeCourseComposer).not.toHaveBeenCalled();
    expect(host.wakeOverworld).not.toHaveBeenCalled();
  });

  it('preserves the ordinary world handoff while clearing the busy overlay before wake', async () => {
    const { controller, host, wakeData } = createHarness();

    await controller.returnToWorld();

    expect(host.stopEditorScene).toHaveBeenCalledOnce();
    expect(hideBusyOverlay).toHaveBeenCalledOnce();
    expect(host.wakeOverworld).toHaveBeenCalledWith({
      ...wakeData,
      courseEditorReturned: false,
      courseEditedRoom: null,
    });
    expect(host.wakeCourseComposer).not.toHaveBeenCalled();
    expect(host.stopEditorScene.mock.invocationCallOrder[0]).toBeLessThan(
      hideBusyOverlay.mock.invocationCallOrder[0],
    );
    expect(hideBusyOverlay.mock.invocationCallOrder[0]).toBeLessThan(
      host.wakeOverworld.mock.invocationCallOrder[0],
    );
  });
});

function createHarness(options: {
  returnFailure?: boolean;
  returnToCourseEditor?: boolean;
  activeCourseEdit?: boolean;
} = {}) {
  const wakeData = {
    centerCoordinates: { x: 3, y: 4 },
    roomCoordinates: { x: 3, y: 4 },
    mode: 'browse' as const,
  };
  const courseWakeData = {
    courseId: 'course-1',
    selectedCoordinates: { x: 3, y: 4 },
  };
  const roomSession = {
    buildReturnToWorldWakeData: vi.fn(async () => (
      options.returnFailure ? null : { ...wakeData }
    )),
  };
  const host = {
    hasActiveCourseEdit: vi.fn(() => options.activeCourseEdit ?? false),
    buildCourseEditedRoomData: vi.fn(() => (
      options.activeCourseEdit ? { courseId: 'course-1', roomId: '3,4' } : null
    )),
    stopEditorScene: vi.fn(),
    shouldReturnToCourseEditor: vi.fn(() => options.returnToCourseEditor ?? false),
    buildCourseEditorWakeData: vi.fn(() => courseWakeData),
    wakeCourseComposer: vi.fn(),
    wakeOverworld: vi.fn(),
    getPersistenceStatusText: vi.fn(() => 'Room save failed.'),
  };

  return {
    controller: new EditorSceneFlowController(roomSession as never, host as never),
    courseWakeData,
    host,
    roomSession,
    wakeData,
  };
}
