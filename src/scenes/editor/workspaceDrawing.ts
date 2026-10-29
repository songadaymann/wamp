import { editorState, TILE_SIZE, type ToolName } from '../../config';
import type { EditorEditRuntime } from './editRuntime';
import { getEditorStampKind, isEditorLineCurve, isEditorShapeOutline,
  isPathEditorTool, isPencilSprayPlacement, resolveEditorLineEnd } from './editorToolSelection';
import { placeEditorPencilStroke, resolveEditorPencilOrigin } from './pencilStroke';
import { EditorPathBendController } from './shapeInteraction';
import { resolveShapeEnd, type EditorShapeKind, type TilePoint } from './shapeTiles';
import { forEachDraggedTileCell } from './stampDrag';
import { EditorSprayTicker } from './sprayTicker';

type DrawingRuntime = Pick<EditorEditRuntime,
  'beginTileBatch' | 'commitTileBatch' | 'cancelTileBatch' | 'beginObjectBatch' |
  'commitObjectBatch' | 'cancelObjectBatch' | 'placeTileAt' | 'placeTileStroke' |
  'eraseTileAt' | 'eraseStampAt' | 'paintRandomizeAt' | 'floodFill' | 'floodErase' | 'stampShape'>;
type StrokeKind = 'pencil' | 'eraser' | 'randomize' | 'objects' | 'eraseStamp';
type ShapeTool = 'rect' | 'ellipse' | 'line' | 'copy';
interface Shape<S> { slice: S; start: TilePoint; tool: ShapeTool; erase: boolean; curve: boolean }
interface Stroke<S> {
  slice: S; kind: StrokeKind; touch: boolean; start: TilePoint; previous: TilePoint | null;
}

export interface EditorDrawingWorkspace<S> {
  sliceAt(worldX: number, worldY: number): S | null;
  originOf(slice: S): TilePoint;
  runtimeOf(slice: S): DrawingRuntime;
  /** Return local tile coordinates, clamped to the starting slice for a shape. */
  clampToSlice(slice: S, world: TilePoint): TilePoint;
  placeObject(slice: S, tile: TilePoint): void;
  copy(slice: S, start: TilePoint, end: TilePoint): void;
  preview(slice: S, kind: EditorShapeKind, start: TilePoint, end: TilePoint,
    options: { copy: boolean; outline: boolean; mid?: TilePoint }): void;
  clearPreview(): void;
  finished?(event: { slice: S; kind: 'stroke' | 'shape' | 'curve' | 'copy'; erase: boolean; limited: boolean }): void;
}

/** One drawing state machine for a one-slice room or a multi-cell workspace.
 * Mouse commits each cell as it leaves; touch keeps every visited cell open so a
 * second finger or lifecycle cancellation rolls back the complete gesture.
 */
export class EditorWorkspaceDrawingController<S> {
  private stroke: Stroke<S> | null = null;
  private shape: Shape<S> | null = null;
  private readonly tileBatches = new Set<S>();
  private readonly objectBatches = new Set<S>();
  private readonly spray = new EditorSprayTicker();
  private readonly path: EditorPathBendController<S>;

  constructor(private readonly workspace: EditorDrawingWorkspace<S>) {
    this.path = new EditorPathBendController({
      preview: bend => workspace.preview(bend.target, 'curve', bend.start, bend.end,
        { copy: false, outline: false, mid: bend.mid }),
      stamp: bend => {
        const runtime = workspace.runtimeOf(bend.target);
        runtime.beginTileBatch();
        runtime.stampShape('curve', bend.start.x, bend.start.y, bend.end.x, bend.end.y,
          { erase: bend.erase, mid: bend.mid });
        runtime.commitTileBatch();
        workspace.finished?.({ slice: bend.target, kind: 'curve', erase: bend.erase, limited: false });
      },
      finish: () => workspace.clearPreview(),
    });
  }

  get hasStroke(): boolean { return this.stroke !== null; }
  get hasShape(): boolean { return this.shape !== null; }
  get hasBend(): boolean { return this.path.bend !== null; }
  get isDrawing(): boolean { return this.hasStroke || this.hasShape; }

  pencilOrigin(slice: S, tile: TilePoint): TilePoint {
    return this.stroke?.slice === slice && this.stroke.kind === 'pencil'
      ? resolveEditorPencilOrigin(this.stroke.start, tile) : tile;
  }

  begin(world: TilePoint, tool: ToolName, options: { erase?: boolean; touch?: boolean } = {}): boolean {
    const slice = this.workspace.sliceAt(world.x, world.y);
    if (slice === null || tool === 'move') return false;
    const tile = this.localTile(slice, world);
    const erase = Boolean(options.erase);
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || (tool === 'copy' && !erase)) {
      this.shape = { slice, start: tile, tool, erase, curve: isPathEditorTool(tool) && isEditorLineCurve() };
      this.previewShape(tile);
    } else if (tool === 'fill') {
      const runtime = this.workspace.runtimeOf(slice);
      runtime.beginTileBatch();
      if (erase) runtime.floodErase(tile.x, tile.y); else runtime.floodFill(tile.x, tile.y);
      runtime.commitTileBatch();
      this.workspace.finished?.({ slice, kind: 'stroke', erase, limited: false });
    } else {
      const stampErase = erase && (isPencilSprayPlacement() || (tool === 'pencil' && editorState.paletteMode === 'tiles'));
      const kind: StrokeKind = stampErase ? 'eraseStamp' : erase || tool === 'eraser' || tool === 'copy'
        ? 'eraser' : tool === 'randomize' ? 'randomize' : 'pencil';
      this.stroke = { slice, kind, touch: Boolean(options.touch), start: tile, previous: null };
      this.openBatch(slice, kind);
      this.paint(world, true);
    }
    return true;
  }

  beginObjects(world: TilePoint, touch = false): boolean {
    const slice = this.workspace.sliceAt(world.x, world.y);
    if (slice === null) return false;
    const tile = this.localTile(slice, world);
    this.stroke = { slice, kind: 'objects', touch, start: tile, previous: tile };
    this.openBatch(slice, 'objects');
    this.workspace.placeObject(slice, tile);
    return true;
  }

  move(world: TilePoint, shift = false): void {
    const bend = this.path.bend;
    if (bend) { this.path.update(this.workspace.clampToSlice(bend.target, world)); return; }
    if (this.shape) {
      this.previewShape(this.shapeEnd(world, shift));
      return;
    }
    const stroke = this.stroke;
    if (!stroke) return;
    const slice = this.workspace.sliceAt(world.x, world.y);
    if (slice === null) return;
    if (slice !== stroke.slice) {
      if (!stroke.touch) this.commitBatch(stroke.slice, stroke.kind);
      stroke.slice = slice;
      stroke.start = this.localTile(slice, world);
      stroke.previous = null;
      this.openBatch(slice, stroke.kind);
    }
    if (!this.isSpraying()) this.paint(world, false);
  }

  tickSpray(deltaMs: number, world: TilePoint, held: boolean): void {
    const active = held && this.isSpraying() && this.stroke !== null
      && this.workspace.sliceAt(world.x, world.y) === this.stroke.slice;
    this.spray.tick(deltaMs, active, editorState.pencilSprayBrushSize, editorState.pencilSprayRate,
      () => this.paint(world, true));
  }

  finish(world: TilePoint, shift = false): void {
    const shape = this.shape;
    if (shape) {
      const end = this.shapeEnd(world, shift);
      this.shape = null;
      if (shape.curve) {
        this.path.begin(shape.slice, shape.start, end, shape.erase);
        return;
      }
      if (shape.tool === 'copy') this.workspace.copy(shape.slice, shape.start, end);
      else {
        const runtime = this.workspace.runtimeOf(shape.slice);
        const kind = getEditorStampKind(shape.tool);
        if (kind) {
          runtime.beginTileBatch();
          runtime.stampShape(kind, shape.start.x, shape.start.y, end.x, end.y,
            { outline: isEditorShapeOutline(shape.tool), erase: shape.erase });
          runtime.commitTileBatch();
        }
      }
      this.workspace.clearPreview();
      this.workspace.finished?.({ slice: shape.slice, kind: shape.tool === 'copy' ? 'copy' : 'shape',
        erase: shape.erase, limited: this.workspace.sliceAt(world.x, world.y) !== shape.slice });
    }
    const stroke = this.stroke;
    for (const slice of this.tileBatches) this.workspace.runtimeOf(slice).commitTileBatch();
    for (const slice of this.objectBatches) this.workspace.runtimeOf(slice).commitObjectBatch();
    this.clearStroke();
    if (stroke) this.workspace.finished?.({ slice: stroke.slice, kind: 'stroke',
      erase: stroke.kind === 'eraser' || stroke.kind === 'eraseStamp', limited: false });
  }

  resolveBend(left: boolean, right: boolean): boolean { return this.path.resolve(left, right); }
  commitBend(): void { this.path.commit(); }

  clearShapes(): void {
    this.shape = null; this.path.clear(); this.workspace.clearPreview();
  }

  /** Phaser shutdown has already destroyed presentation layers: forget state without touching them. */
  reset(): void { this.clearStroke(); this.shape = null; this.path.clear(); }

  cancel(): void {
    for (const slice of this.tileBatches) this.workspace.runtimeOf(slice).cancelTileBatch();
    for (const slice of this.objectBatches) this.workspace.runtimeOf(slice).cancelObjectBatch();
    this.clearStroke(); this.clearShapes();
  }

  private localTile(slice: S, world: TilePoint): TilePoint {
    const origin = this.workspace.originOf(slice);
    return { x: Math.floor((world.x - origin.x) / TILE_SIZE), y: Math.floor((world.y - origin.y) / TILE_SIZE) };
  }

  private openBatch(slice: S, kind: StrokeKind): void {
    const batches = kind === 'objects' ? this.objectBatches : this.tileBatches;
    if (batches.has(slice)) return;
    const runtime = this.workspace.runtimeOf(slice);
    if (kind === 'objects') runtime.beginObjectBatch(true); else runtime.beginTileBatch();
    batches.add(slice);
  }

  private commitBatch(slice: S, kind: StrokeKind): void {
    if (kind === 'objects') {
      this.workspace.runtimeOf(slice).commitObjectBatch(); this.objectBatches.delete(slice);
    } else {
      this.workspace.runtimeOf(slice).commitTileBatch(); this.tileBatches.delete(slice);
    }
  }

  private clearStroke(): void {
    this.stroke = null; this.tileBatches.clear(); this.objectBatches.clear(); this.spray.reset();
  }

  private isSpraying(): boolean {
    return isPencilSprayPlacement() && (this.stroke?.kind === 'pencil' || this.stroke?.kind === 'eraseStamp');
  }

  private paint(world: TilePoint, initial: boolean): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const { slice, kind } = stroke;
    const runtime = this.workspace.runtimeOf(slice), tile = this.localTile(slice, world);
    if (kind === 'objects') {
      if (stroke.previous) forEachDraggedTileCell(stroke.previous, tile,
        (x, y) => this.workspace.placeObject(slice, { x, y }));
      else this.workspace.placeObject(slice, tile);
      stroke.previous = tile;
    } else if (kind === 'pencil') {
      if (this.isSpraying() || initial) runtime.placeTileAt(world.x, world.y);
      else placeEditorPencilStroke(runtime, stroke.previous, resolveEditorPencilOrigin(stroke.start, tile),
        this.workspace.originOf(slice));
      stroke.previous = resolveEditorPencilOrigin(stroke.start, tile);
    } else if (kind === 'eraseStamp') runtime.eraseStampAt(world.x, world.y);
    else if (kind === 'eraser') runtime.eraseTileAt(world.x, world.y);
    else runtime.paintRandomizeAt(world.x, world.y);
  }

  private shapeEnd(world: TilePoint, shift: boolean): TilePoint {
    const shape = this.shape!;
    const tile = this.workspace.clampToSlice(shape.slice, world);
    if (shape.tool === 'copy') return tile;
    return shape.tool === 'line' ? resolveEditorLineEnd(shape.start, tile, shift)
      : resolveShapeEnd(shape.start, tile, shift);
  }

  private previewShape(end: TilePoint): void {
    const shape = this.shape!;
    const kind = shape.tool === 'copy' ? 'rect' : getEditorStampKind(shape.tool);
    if (kind) this.workspace.preview(shape.slice, kind, shape.start, end,
      { copy: shape.tool === 'copy', outline: shape.tool !== 'copy' && isEditorShapeOutline(shape.tool) });
  }
}
