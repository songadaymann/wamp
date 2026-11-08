import { TILE_SIZE, editorState } from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';
import type { EditorShapeKind } from './shapeTiles';
import { canRepeatSelectedEditorObject } from './editorToolSelection';

export type EditorPreviewSmokeCommand =
  | { op: 'beginBatch' }
  | { op: 'commitBatch' }
  | { op: 'placeCells'; cells: Array<{ x: number; y: number }> }
  | { op: 'eraseCells'; cells: Array<{ x: number; y: number }> }
  | {
      op: 'stampShape';
      kind: EditorShapeKind;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      outline: boolean;
      erase: boolean;
      mid?: { x: number; y: number };
    }
  | { op: 'floodFill'; x: number; y: number }
  | { op: 'copy'; x1: number; y1: number; x2: number; y2: number }
  | { op: 'paste'; x: number; y: number }
  | { op: 'undo' }
  | { op: 'redo' }
  | { op: 'clearAllTiles' }
  | { op: 'clearCurrentLayer' }
  | { op: 'capture'; name: string }
  | { op: 'applyCapture'; name: string }
  | { op: 'fitToScreen' }
  | { op: 'setCamera'; zoom: number; centerTileX: number; centerTileY: number };

export interface EditorPreviewSmokeResult extends Record<string, unknown> {
  ok: boolean;
  reason?: string;
  commandIndex?: number;
  captures?: Record<string, RoomSnapshot>;
}

export interface EditorPreviewSmokeHost {
  beginTileBatch(): void;
  commitTileBatch(): void;
  placeTileAt(worldX: number, worldY: number): void;
  eraseTileAt(worldX: number, worldY: number): void;
  stampShape(
    kind: EditorShapeKind,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: { outline: boolean; erase: boolean; mid?: { x: number; y: number } },
  ): void;
  floodFill(x: number, y: number): void;
  copyTilesToClipboard(x1: number, y1: number, x2: number, y2: number): void;
  pasteClipboardAt(x: number, y: number): void;
  undo(): void;
  redo(): void;
  clearAllTiles(): void;
  clearCurrentLayer(): void;
  exportRoomSnapshot(): RoomSnapshot;
  applyRoomSnapshot(room: RoomSnapshot): void;
  fitToScreen(): void;
  setCamera(zoom: number, centerTileX: number, centerTileY: number): void;
}

/**
 * Narrow command surface for safety-preview browser proof. The raw edit
 * runtime remains private, and production builds cannot enable this path.
 */
export function runEditorPreviewSmokeCommands(
  host: EditorPreviewSmokeHost,
  commands: readonly EditorPreviewSmokeCommand[],
): EditorPreviewSmokeResult {
  const previewSmokeEnabled = import.meta.env.VITE_ENABLE_TEST_RESET === '1'
    && new URLSearchParams(window.location.search).get('previewSmoke') === '1';
  if (!previewSmokeEnabled) {
    return { ok: false, reason: 'preview-smoke-disabled' };
  }
  if (!Array.isArray(commands as unknown) || commands.length > 5_000) {
    return { ok: false, reason: 'invalid-editor-command-list' };
  }

  const captures: Record<string, RoomSnapshot> = {};
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
    const command = commands[commandIndex]!;
    try {
      switch (command.op) {
        case 'beginBatch':
          host.beginTileBatch();
          break;
        case 'commitBatch':
          host.commitTileBatch();
          break;
        case 'placeCells':
          command.cells.forEach(({ x, y }) => {
            host.placeTileAt(x * TILE_SIZE + 1, y * TILE_SIZE + 1);
          });
          break;
        case 'eraseCells':
          command.cells.forEach(({ x, y }) => {
            host.eraseTileAt(x * TILE_SIZE + 1, y * TILE_SIZE + 1);
          });
          break;
        case 'stampShape':
          host.stampShape(
            command.kind,
            command.x1,
            command.y1,
            command.x2,
            command.y2,
            { outline: command.outline, erase: command.erase, mid: command.mid },
          );
          break;
        case 'floodFill':
          host.floodFill(command.x, command.y);
          break;
        case 'copy':
          host.copyTilesToClipboard(command.x1, command.y1, command.x2, command.y2);
          break;
        case 'paste':
          host.pasteClipboardAt(command.x, command.y);
          break;
        case 'undo':
          host.undo();
          break;
        case 'redo':
          host.redo();
          break;
        case 'clearAllTiles':
          host.clearAllTiles();
          break;
        case 'clearCurrentLayer':
          host.clearCurrentLayer();
          break;
        case 'capture':
          if (!/^[a-z][a-zA-Z0-9]*$/.test(command.name)) {
            return { ok: false, reason: 'invalid-capture-name', commandIndex };
          }
          captures[command.name] = host.exportRoomSnapshot();
          break;
        case 'applyCapture': {
          const capture = captures[command.name];
          if (!capture) {
            return { ok: false, reason: 'capture-not-found', commandIndex };
          }
          host.applyRoomSnapshot(JSON.parse(JSON.stringify(capture)) as RoomSnapshot);
          break;
        }
        case 'fitToScreen':
          host.fitToScreen();
          break;
        case 'setCamera':
          host.setCamera(command.zoom, command.centerTileX, command.centerTileY);
          break;
        default:
          return {
            ok: false,
            reason: `unsupported-editor-command:${String((command as { op?: unknown }).op)}`,
            commandIndex,
          };
      }
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        commandIndex,
      };
    }
  }
  return { ok: true, captures };
}

export function inspectCoursePreviewSmokeTile(
  tileX: number,
  tileY: number,
  host: {
    getSelectedSlice(): {
      roomId: string;
      origin: { x: number; y: number };
      layers: Map<string, { getTileAt(x: number, y: number): { index: number } | null }>;
      runtime: { exportRoomSnapshot(): RoomSnapshot };
    } | null;
    getCamera(): {
      scrollX: number;
      scrollY: number;
      matrix: { transformPoint: (x: number, y: number) => { x: number; y: number } };
    };
  },
): Record<string, unknown> {
  const slice = host.getSelectedSlice();
  if (!slice) return { ok: false, reason: 'no-selected-course-room' };
  const camera = host.getCamera();
  const worldX = slice.origin.x + (tileX + 0.5) * TILE_SIZE;
  const worldY = slice.origin.y + (tileY + 0.5) * TILE_SIZE;
  return {
    ok: true,
    roomId: slice.roomId,
    toolState: {
      paletteMode: editorState.paletteMode,
      activeTool: editorState.activeTool,
      selectedObjectId: editorState.selectedObjectId,
      activeLayer: editorState.activeLayer,
      repeatable: canRepeatSelectedEditorObject(),
    },
    tileValue: slice.layers.get(editorState.activeLayer)?.getTileAt(tileX, tileY)?.index ?? -1,
    snapshot: slice.runtime.exportRoomSnapshot(),
    screenPoint: camera.matrix.transformPoint(
      worldX - camera.scrollX,
      worldY - camera.scrollY,
    ),
  };
}
