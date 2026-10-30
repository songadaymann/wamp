import type Phaser from 'phaser';
import { canPlacedObjectBeContainer, canPlacedObjectBeLinkedObjectTarget,
  canPlacedObjectTriggerOtherObjects, canPlacedObjectUseObjectLink, editorState, type PlacedObject } from '../../config';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { canPlacedObjectUseObjectPath } from '../../placedObjects/objectPaths';
import { getRoomVideo, linkPressurePlateToRoomVideo } from '../../roomVideo/editing';
import { hitsRoomVideoAnchor, isRoomVideoLinkTarget, roomVideoAnchorPoint, roomVideoFrameBounds } from '../../roomVideo/link';
import type { EditorEditRuntime } from './editRuntime';
import { canStoreEditorContainerContents, getContainerAcceptedContentsLabel, getContainerName, unsupportedContainerSelectionText } from './inspectorViewModel';
import type { EditorObjectLinkCopy } from './objectLinkCopy';

type Point = { x: number; y: number };
interface InspectorDataSource<R> {
  placed(ref: R): PlacedObject;
  runtime(ref: R): EditorEditRuntime;
  origin(ref: R): Point;
  connecting(): R | null;
  findAt(world: Point, predicate: (ref: R) => boolean): R | null;
  targets(source: R): R[];
  eligibleTargets(source: R): R[];
  setLinkTarget(source: R, target: R): boolean;
  clearLink(source: R): boolean;
  clearCrossLink(source: R): void;
  prune(scope: string, instanceId: string | null | undefined): void;
  targetSummary(source: R, target: R): string;
  connectionChanged(source: R, status: string, keepConnecting: boolean): void;
  clearConnecting(): void;
  containerFocused(ref: R, status?: string): void;
  render(): void;
  zoom(): number;
  copy: EditorObjectLinkCopy;
}

/** Shared inspector actions and world-space overlays; storage policy stays in the data source. */
export class EditorInspectorCore<R> {
  constructor(private readonly source: InspectorDataSource<R>) {}

  clickConnection(world: Point): boolean {
    const source = this.source.connecting();
    if (!source) { this.source.clearConnecting(); return false; }
    const placed = this.source.placed(source), runtime = this.source.runtime(source);
    if (canPlacedObjectTriggerOtherObjects(placed) && this.hitsVideo(source, world)) {
      if (linkPressurePlateToRoomVideo(runtime, placed.instanceId ?? '')) {
        this.source.clearCrossLink(source);
        this.updateConnection(source, 'Pressure plate linked to the video.', false);
      }
      return true;
    }
    const target = this.source.findAt(world, ref => this.canLink(source, ref));
    if (!target) {
      this.updateConnection(source, this.source.copy.pickTargetStatus(placed), true);
      return true;
    }
    const targetObject = this.source.placed(target);
    if (canPlacedObjectUseObjectPath(placed) && runtime === this.source.runtime(target)) {
      const result = runtime.toggleObjectPathTarget(placed.instanceId ?? '', targetObject.instanceId);
      if (result !== 'unchanged') {
        this.source.clearCrossLink(source);
        const count = runtime.getObjectPathTargetIds(placed.instanceId).length;
        const label = this.source.copy.targetLabel(targetObject.id);
        this.updateConnection(source, result === 'added'
          ? `Added ${label} stop ${count}. Click another anchor, or use Done Later.`
          : `Removed ${label} from the path. Click another anchor, or use Done Later.`, true);
      }
      return true;
    }
    if (this.source.setLinkTarget(source, target)) {
      this.updateConnection(source,
        `${this.source.copy.sourceLabel(placed)} linked to ${this.source.targetSummary(source, target)}.`, false);
    }
    return true;
  }

  clearLink(source: R | null): void {
    if (source && canPlacedObjectUseObjectLink(this.source.placed(source)) && this.source.clearLink(source)) {
      this.updateConnection(source, `${this.source.copy.sourceLabel(this.source.placed(source))} link cleared.`, false);
    }
  }

  pruneRemoved(scope: string, instanceId: string | null | undefined): void { this.source.prune(scope, instanceId); }

  clickContainer(world: Point): boolean {
    const ref = this.source.findAt(world, item => canPlacedObjectBeContainer(this.source.placed(item)));
    if (!ref) return false;
    const container = this.source.placed(ref);
    if (!container.instanceId) return false;
    this.source.containerFocused(ref);
    const selected = this.selectedObject();
    const unsupported = unsupportedContainerSelectionText(selected);
    if (unsupported) {
      this.source.containerFocused(ref, unsupported); this.source.render(); return true;
    }
    if (selected && (selected.category === 'enemy' || selected.category === 'collectible')) {
      if (!canStoreEditorContainerContents(container.id, selected)) {
        this.source.containerFocused(ref,
          `${getContainerName(container.id)} can only hold ${getContainerAcceptedContentsLabel(container.id)}.`);
      } else if (this.source.runtime(ref).setContainerContents(container.instanceId, selected.id)) {
        this.source.containerFocused(ref, `${getContainerName(container.id)} now holds ${selected.name}.`);
      }
    }
    this.source.render();
    return true;
  }

  drawPressureOverlay(graphics: Phaser.GameObjects.Graphics, source: R | null, world: Point): void {
    if (!source) return;
    const placed = this.source.placed(source), targets = this.source.targets(source);
    this.drawVideoAnchor(graphics, source, world);
    let previous: R = source;
    for (const target of targets) { this.drawLink(graphics, previous, target, 0x6dd5ff, 0.9); previous = target; }
    this.drawBounds(graphics, source, 0xc3f4ff, 0.88);
    const connecting = this.source.connecting();
    if (connecting === null || this.source.placed(connecting).instanceId !== placed.instanceId) return;
    const hovered = this.source.findAt(world, ref => this.canLink(source, ref));
    for (const target of this.source.eligibleTargets(source)) {
      const active = hovered !== null && this.source.placed(hovered).instanceId === this.source.placed(target).instanceId;
      this.drawBounds(graphics, target, active ? 0x9dff8a : 0x7ad3ff, active ? 0.95 : 0.55);
    }
    const preview = this.previewSource(source, targets, hovered);
    if (hovered) this.drawLink(graphics, preview, hovered, 0x9dff8a, 0.95);
    else if (!this.hitsVideo(source, world)) {
      const at = this.anchor(preview, -4);
      graphics.lineStyle(2, 0xffd36b, 0.5); graphics.beginPath();
      graphics.moveTo(at.x, at.y); graphics.lineTo(world.x, world.y); graphics.strokePath();
    }
  }

  drawContainerOverlay(graphics: Phaser.GameObjects.Graphics, ref: R): void {
    const selected = this.selectedObject(), container = this.source.placed(ref);
    const canStore = canStoreEditorContainerContents(container.id, selected);
    const contents = selected?.category === 'enemy' || selected?.category === 'collectible';
    const color = canStore ? 0x9dff8a : contents ? 0xffc76b : 0xffe0a6;
    this.drawBounds(graphics, ref, color, canStore ? 0.92 : 0.74);
    const at = this.anchor(ref, -6);
    graphics.fillStyle(color, 0.86); graphics.fillCircle(at.x, at.y, 3);
  }

  private selectedObject() {
    return editorState.selectedObjectId ? getEditorObjectConfigById(editorState.selectedObjectId) ?? null : null;
  }

  private updateConnection(ref: R, status: string, keep: boolean): void {
    this.source.connectionChanged(ref, status, keep); this.source.render();
  }

  private canLink(source: R, target: R): boolean {
    const a = this.source.placed(source), b = this.source.placed(target);
    return a.instanceId !== b.instanceId && canPlacedObjectBeLinkedObjectTarget(a, b);
  }

  private anchor(ref: R, dy: number): Point {
    const placed = this.source.placed(ref), origin = this.source.origin(ref);
    return { x: origin.x + placed.x, y: origin.y + placed.y + dy };
  }

  private drawBounds(graphics: Phaser.GameObjects.Graphics, ref: R, color: number, alpha: number): void {
    const bounds = this.source.runtime(ref).getPlacedObjectBounds(this.source.placed(ref));
    graphics.lineStyle(2, color, alpha);
    graphics.strokeRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 6);
  }

  private drawLink(graphics: Phaser.GameObjects.Graphics, source: R, target: R, color: number, alpha: number): void {
    this.drawLineToPoint(graphics, source, this.anchor(target, -6), color, alpha);
  }

  private drawLineToPoint(graphics: Phaser.GameObjects.Graphics, source: R, point: Point, color: number, alpha: number): void {
    const at = this.anchor(source, -4);
    graphics.lineStyle(2, color, alpha); graphics.beginPath();
    graphics.moveTo(at.x, at.y); graphics.lineTo(point.x, point.y); graphics.strokePath();
    graphics.fillStyle(color, alpha * 0.9); graphics.fillCircle(at.x, at.y, 3); graphics.fillCircle(point.x, point.y, 3);
  }

  private previewSource(source: R, targets: R[], hovered: R | null): R {
    if (!canPlacedObjectUseObjectPath(this.source.placed(source))) return source;
    const path = hovered ? targets.filter(ref => this.source.placed(ref).instanceId !== this.source.placed(hovered).instanceId) : targets;
    return path[path.length - 1] ?? source;
  }

  private hitsVideo(source: R, world: Point): boolean {
    const origin = this.source.origin(source);
    return hitsRoomVideoAnchor(getRoomVideo(this.source.runtime(source)), world.x, world.y,
      this.source.zoom(), origin.x, origin.y);
  }

  private drawVideoAnchor(graphics: Phaser.GameObjects.Graphics, source: R, world: Point): void {
    const placed = this.source.placed(source);
    if (!canPlacedObjectTriggerOtherObjects(placed)) return;
    const video = getRoomVideo(this.source.runtime(source));
    if (!video?.trigger) return;
    const connecting = this.source.connecting() !== null;
    const linked = isRoomVideoLinkTarget(placed.triggerTargetInstanceId);
    if (!connecting && !linked) return;
    const origin = this.source.origin(source), hovering = this.hitsVideo(source, world);
    const color = hovering && connecting ? 0x9dff8a : connecting ? 0x7ad3ff : 0x6dd5ff;
    const alpha = hovering && connecting ? 0.95 : connecting ? 0.55 : 0.9;
    const bounds = roomVideoFrameBounds(video, origin.x, origin.y);
    graphics.lineStyle(2, color, alpha); graphics.strokeRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 6);
    const anchor = roomVideoAnchorPoint(video, origin.x, origin.y);
    if (connecting && hovering) this.drawLineToPoint(graphics, source, anchor, 0x9dff8a, 0.95);
    else if (linked) this.drawLineToPoint(graphics, source, anchor, 0x6dd5ff, 0.9);
    else { graphics.fillStyle(color, 0.9); graphics.fillCircle(anchor.x, anchor.y, 3); }
  }
}
