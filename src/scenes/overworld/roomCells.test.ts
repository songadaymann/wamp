import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {},
}));

import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { OverworldRoomCellController } from './roomCells';

function createGraphics() {
  return {
    clear: vi.fn(),
    destroy: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: vi.fn(),
    setDepth: vi.fn(),
  };
}

describe('OverworldRoomCellController focus highlights', () => {
  it('moves current and selected highlights without redrawing cached room cells', () => {
    const graphics = [createGraphics(), createGraphics(), createGraphics()];
    let currentCoordinates = { x: 0, y: 0 };
    let selectedCoordinates = { x: 0, y: 0 };
    const controller = new OverworldRoomCellController({
      scene: {
        add: {
          graphics: vi.fn(() => graphics.shift()),
          text: vi.fn(() => {
            throw new Error('No frontier labels expected in this test.');
          }),
        },
      },
      getWorldWindow: () => ({ center: { x: 0, y: 0 }, radius: 1 }),
      getZoom: () => 1,
      getRoomOrigin: (coordinates: { x: number; y: number }) => ({
        x: coordinates.x * ROOM_PX_WIDTH,
        y: coordinates.y * ROOM_PX_HEIGHT,
      }),
      getCellStateAt: () => 'published',
      getRoomEditorCount: () => 0,
      getCurrentRoomCoordinates: () => currentCoordinates,
      getSelectedCoordinates: () => selectedCoordinates,
      getMode: () => 'play',
      isRoomInActiveCourse: () => false,
      getExpandedRoomIdAt: () => null,
    } as never);
    controller.create();
    const harness = controller as unknown as {
      roomFillGraphics: ReturnType<typeof createGraphics>;
      roomFrameGraphics: ReturnType<typeof createGraphics>;
      roomFocusGraphics: ReturnType<typeof createGraphics>;
    };

    controller.redraw();
    harness.roomFillGraphics.clear.mockClear();
    harness.roomFrameGraphics.clear.mockClear();
    harness.roomFocusGraphics.clear.mockClear();
    harness.roomFocusGraphics.fillRect.mockClear();
    currentCoordinates = { x: 1, y: 0 };
    selectedCoordinates = { x: 1, y: 0 };

    controller.redrawFocusHighlights();

    expect(harness.roomFillGraphics.clear).not.toHaveBeenCalled();
    expect(harness.roomFrameGraphics.clear).not.toHaveBeenCalled();
    expect(harness.roomFocusGraphics.clear).toHaveBeenCalledOnce();
    expect(harness.roomFocusGraphics.fillRect).toHaveBeenCalledWith(
      ROOM_PX_WIDTH + 4,
      4,
      ROOM_PX_WIDTH - 8,
      3,
    );
    expect(harness.roomFocusGraphics.fillRect).toHaveBeenCalledWith(
      ROOM_PX_WIDTH + 8,
      8,
      ROOM_PX_WIDTH - 16,
      2,
    );
  });
});
