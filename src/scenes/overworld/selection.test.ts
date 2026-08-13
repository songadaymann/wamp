import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverworldSelectionController } from './selection';

const {
  setActiveCourseDraftSessionSelectedRoom,
  setFocusedCoordinatesInUrl,
} = vi.hoisted(() => ({
  setActiveCourseDraftSessionSelectedRoom: vi.fn(),
  setFocusedCoordinatesInUrl: vi.fn(),
}));

vi.mock('phaser', () => ({ default: {} }));

vi.mock('../../courses/draftSession', () => ({
  setActiveCourseDraftSessionSelectedRoom,
}));

vi.mock('../../navigation/worldNavigation', () => ({
  setFocusedCoordinatesInUrl,
}));

vi.mock('../../audio/sfx', () => ({
  playSfx: vi.fn(),
}));

describe('overworld room selection', () => {
  beforeEach(() => {
    setActiveCourseDraftSessionSelectedRoom.mockReset();
    setFocusedCoordinatesInUrl.mockReset();
  });

  it('updates the focused room URL when a room is selected', () => {
    const host = createHost('browse');
    const controller = new OverworldSelectionController(host as never);

    controller.selectRoomCoordinates({ x: 12, y: -4 });

    expect(host.setSelectedCoordinates).toHaveBeenCalledWith({ x: 12, y: -4 });
    expect(host.setCurrentRoomCoordinates).toHaveBeenCalledWith({ x: 12, y: -4 });
    expect(setFocusedCoordinatesInUrl).toHaveBeenCalledWith({ x: 12, y: -4 });
  });

  it('updates the selected URL without moving the active play room', () => {
    const host = createHost('play');
    const controller = new OverworldSelectionController(host as never);

    controller.selectRoomCoordinates({ x: 3, y: 7 });

    expect(host.setCurrentRoomCoordinates).not.toHaveBeenCalled();
    expect(setFocusedCoordinatesInUrl).toHaveBeenCalledWith({ x: 3, y: 7 });
  });
});

function createHost(mode: 'browse' | 'play') {
  return {
    getMode: vi.fn(() => mode),
    setSelectedCoordinates: vi.fn(),
    setCurrentRoomCoordinates: vi.fn(),
    updateSelectedSummary: vi.fn(),
    refreshLeaderboardForSelection: vi.fn(async () => {}),
    redrawWorld: vi.fn(),
    renderHud: vi.fn(),
  };
}
