import Phaser from 'phaser';
import {
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  canPlacedObjectBePressurePlateTarget,
  canPlacedObjectTriggerOtherObjects,
  editorState,
  getObjectById,
  type PlacedObject,
} from '../../config';
import {
  cloneCourseSnapshot,
  type CourseSnapshot,
} from '../../courses/model';
import {
  clearCoursePressurePlateLinksForInstance,
  getCoursePressurePlateLink,
  setCoursePressurePlateLink,
} from '../../courses/pressurePlateLinks';
import type { EditorEditRuntime } from '../editor/editRuntime';
import type { EditorInspectorState } from '../editor/uiBridge';
import {
  buildContainerInspectorState,
  buildPressurePlateInspectorState,
  createEmptyCourseInspectorState,
  getContainerAcceptedContentsLabel,
  getContainerName,
  getPressurePlateTargetLabel,
} from './inspectorUi';

interface CourseInspectorRoomSlice {
  roomId: string;
  origin: { x: number; y: number };
  placedObjects: PlacedObject[];
  runtime: EditorEditRuntime;
}

interface CoursePlacedObjectRef {
  slice: CourseInspectorRoomSlice;
  placed: PlacedObject;
}

interface CourseEditorObjectInspectorHost {
  getRoomSlices(): Iterable<CourseInspectorRoomSlice>;
  getRoomSliceById(roomId: string): CourseInspectorRoomSlice | null;
  getSelectedSlice(): CourseInspectorRoomSlice | null;
  getSliceAtWorldPoint(worldX: number, worldY: number): CourseInspectorRoomSlice | null;
  getActiveCourseDraft(): CourseSnapshot | null;
  setActiveCourseDraft(draft: CourseSnapshot): void;
  getSliceLabel(slice: CourseInspectorRoomSlice): string;
  renderInspector(state: EditorInspectorState): void;
}

export class CourseEditorObjectInspectorController {
  private focusedPressurePlateInstanceId: string | null = null;
  private connectingPressurePlateInstanceId: string | null = null;
  private pressurePlateStatusText: string | null = null;
  private focusedContainerInstanceId: string | null = null;
  private containerStatusText: string | null = null;
  private pinnedInspector: { kind: 'pressure' | 'container'; instanceId: string } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: CourseEditorObjectInspectorHost,
  ) {}

  isConnectingPressurePlate(): boolean {
    return this.connectingPressurePlateInstanceId !== null;
  }

  hasPinnedInspector(): boolean {
    return this.pinnedInspector !== null;
  }

  getPlacedObjectRefByInstanceId(
    instanceId: string | null | undefined,
    roomId: string | null | undefined = null,
  ): CoursePlacedObjectRef | null {
    if (!instanceId) {
      return null;
    }

    if (roomId) {
      const slice = this.host.getRoomSliceById(roomId);
      const placed = slice?.runtime.getPlacedObjectByInstanceId(instanceId) ?? null;
      return slice && placed ? { slice, placed } : null;
    }

    for (const slice of this.host.getRoomSlices()) {
      const placed = slice.runtime.getPlacedObjectByInstanceId(instanceId);
      if (placed) {
        return { slice, placed };
      }
    }

    return null;
  }

  beginFocusedPressurePlateConnection(): void {
    const focused = this.getFocusedPressurePlateRef();
    if (!focused) {
      this.pressurePlateStatusText = 'Hover or place a pressure plate first.';
      this.renderInspectorUi();
      return;
    }

    this.beginPressurePlateConnection(focused.placed.instanceId ?? '', false);
  }

  clearFocusedPressurePlateConnection(): void {
    const source = this.getFocusedPressurePlateRef();
    if (!source || !canPlacedObjectTriggerOtherObjects(source.placed)) {
      return;
    }

    if (this.setCoursePressurePlateTarget(source, null)) {
      this.pressurePlateStatusText = 'Pressure plate link cleared.';
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = source.placed.instanceId ?? null;
      this.pinInspector('pressure', source.placed.instanceId ?? '');
      this.renderInspectorUi();
    }
  }

  cancelPressurePlateConnection(): void {
    if (!this.connectingPressurePlateInstanceId) {
      return;
    }

    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = 'Pressure plate left unlinked for now.';
    if (this.focusedPressurePlateInstanceId) {
      this.pinInspector('pressure', this.focusedPressurePlateInstanceId);
    }
    this.renderInspectorUi();
  }

  clearFocusedContainerContents(): void {
    const slice = this.host.getSelectedSlice();
    const focused = this.getFocusedContainer();
    if (!slice || !focused || !canPlacedObjectBeContainer(focused)) {
      return;
    }

    if (slice.runtime.setContainerContents(focused.instanceId ?? '', null)) {
      this.focusedContainerInstanceId = focused.instanceId ?? null;
      this.pinInspector('container', focused.instanceId ?? '');
      this.containerStatusText = `${getContainerName(focused.id)} is now empty.`;
      this.renderInspectorUi();
    }
  }

  clearTransientState(): void {
    this.focusedPressurePlateInstanceId = null;
    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = null;
    this.focusedContainerInstanceId = null;
    this.containerStatusText = null;
    this.pinnedInspector = null;
  }

  hideUi(
    pressurePlateGraphics: Phaser.GameObjects.Graphics | null,
    containerGraphics: Phaser.GameObjects.Graphics | null,
  ): void {
    this.clearTransientState();
    pressurePlateGraphics?.clear();
    containerGraphics?.clear();
    this.host.renderInspector(createEmptyCourseInspectorState());
  }

  clearPinnedInspector(): void {
    this.clearTransientState();
    this.renderInspectorUi();
  }

  handleObjectModeSecondaryAction(
    slice: CourseInspectorRoomSlice,
    worldX: number,
    worldY: number,
  ): boolean {
    if (!this.connectingPressurePlateInstanceId) {
      return false;
    }

    if (slice.runtime.canRemoveObjectAt(worldX, worldY)) {
      return false;
    }

    this.cancelPressurePlateConnection();
    return true;
  }

  focusPressurePlate(placed: PlacedObject): void {
    this.focusedPressurePlateInstanceId = placed.instanceId ?? null;
    this.focusedContainerInstanceId = null;
    this.pinInspector('pressure', placed.instanceId ?? '');
    this.pressurePlateStatusText = null;
  }

  handleObjectPlaced(placed: PlacedObject | null): boolean {
    if (placed && canPlacedObjectTriggerOtherObjects(placed)) {
      this.focusedContainerInstanceId = null;
      this.focusedPressurePlateInstanceId = placed.instanceId ?? null;
      this.pinInspector('pressure', placed.instanceId ?? '');
      this.beginPressurePlateConnection(placed.instanceId ?? '', true);
      return true;
    }

    if (placed && canPlacedObjectBeContainer(placed)) {
      this.focusedContainerInstanceId = placed.instanceId ?? null;
      this.focusedPressurePlateInstanceId = null;
      this.pinInspector('container', placed.instanceId ?? '');
      this.containerStatusText = `${getContainerName(placed.id)} placed. Select a ${getContainerAcceptedContentsLabel(placed.id)} and click it to fill the container.`;
      return true;
    }

    return false;
  }

  handleObjectRemoved(roomId: string, removed: PlacedObject): void {
    this.pruneCoursePressurePlateLinksForInstance(roomId, removed.instanceId ?? null);

    if (removed.instanceId === this.connectingPressurePlateInstanceId) {
      this.connectingPressurePlateInstanceId = null;
    }
    if (removed.instanceId === this.focusedPressurePlateInstanceId) {
      this.focusedPressurePlateInstanceId = null;
    }
    if (removed.instanceId === this.focusedContainerInstanceId) {
      this.focusedContainerInstanceId = null;
    }
    if (this.pinnedInspector?.instanceId === removed.instanceId) {
      this.pinnedInspector = null;
    }
    if (canPlacedObjectBePressurePlateTarget(removed)) {
      this.pressurePlateStatusText = `${getPressurePlateTargetLabel(removed.id)} removed. Linked plates were cleared.`;
    }
    if (canPlacedObjectBeContainer(removed)) {
      this.containerStatusText = `${getContainerName(removed.id)} removed.`;
    }
  }

  handlePressurePlateConnectionClick(
    slice: CourseInspectorRoomSlice,
    worldX: number,
    worldY: number,
  ): boolean {
    const source = this.getConnectingPressurePlateRef();
    if (!source) {
      this.connectingPressurePlateInstanceId = null;
      return false;
    }

    const target = slice.runtime.findPlacedObjectAt(
      worldX,
      worldY,
      (placed) =>
        canPlacedObjectBePressurePlateTarget(placed) &&
        placed.instanceId !== source.placed.instanceId
    );
    if (!target) {
      this.pressurePlateStatusText = 'Pick a door, cage, or chest in this course.';
      this.renderInspectorUi();
      return true;
    }

    if (
      this.setCoursePressurePlateTarget(source, {
        slice,
        placed: target,
      })
    ) {
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = source.placed.instanceId ?? null;
      this.pinInspector('pressure', source.placed.instanceId ?? '');
      this.pressurePlateStatusText = `Pressure plate linked to ${this.getPressurePlateTargetSummary({ slice, placed: target }, source.slice)}.`;
      this.renderInspectorUi();
    }
    return true;
  }

  handleContainerContentsClick(
    slice: CourseInspectorRoomSlice,
    worldX: number,
    worldY: number,
  ): boolean {
    const focused = slice.runtime.findPlacedObjectAt(
      worldX,
      worldY,
      (placed) => canPlacedObjectBeContainer(placed)
    );
    if (!focused || !focused.instanceId) {
      return false;
    }

    this.focusedContainerInstanceId = focused.instanceId;
    this.focusedPressurePlateInstanceId = null;
    this.pinInspector('container', focused.instanceId);
    const selectedObject = editorState.selectedObjectId
      ? getObjectById(editorState.selectedObjectId)
      : null;
    if (!selectedObject) {
      this.renderInspectorUi();
      return true;
    }

    const selectedLooksLikeContents =
      selectedObject.category === 'enemy' || selectedObject.category === 'collectible';
    if (!selectedLooksLikeContents) {
      this.renderInspectorUi();
      return true;
    }

    if (!canObjectBeStoredInContainer(focused.id, selectedObject)) {
      this.containerStatusText = `${getContainerName(focused.id)} can only hold ${getContainerAcceptedContentsLabel(focused.id)}.`;
      this.renderInspectorUi();
      return true;
    }

    if (slice.runtime.setContainerContents(focused.instanceId, selectedObject.id)) {
      this.containerStatusText = `${getContainerName(focused.id)} now holds ${selectedObject.name}.`;
      this.renderInspectorUi();
      return true;
    }

    return true;
  }

  updatePressurePlateOverlay(graphics: Phaser.GameObjects.Graphics | null): void {
    graphics?.clear();
    if (!graphics || editorState.isPlaying) {
      this.renderInspectorUi();
      return;
    }

    if (
      this.focusedPressurePlateInstanceId &&
      !this.getPlacedObjectRefByInstanceId(this.focusedPressurePlateInstanceId)
    ) {
      this.focusedPressurePlateInstanceId = null;
    }
    if (
      this.connectingPressurePlateInstanceId &&
      !this.getPlacedObjectRefByInstanceId(this.connectingPressurePlateInstanceId)
    ) {
      this.connectingPressurePlateInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'pressure' &&
      !this.getPlacedObjectRefByInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }

    const pointer = this.scene.input.activePointer;
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const hoveredSlice = this.host.getSliceAtWorldPoint(worldPoint.x, worldPoint.y);
    if (!this.connectingPressurePlateInstanceId) {
      const hoveredTrigger = hoveredSlice?.runtime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) => canPlacedObjectTriggerOtherObjects(placed)
      );
      if (hoveredTrigger) {
        if (this.focusedPressurePlateInstanceId !== hoveredTrigger.instanceId) {
          this.pressurePlateStatusText = null;
        }
        this.focusedPressurePlateInstanceId = hoveredTrigger.instanceId ?? null;
      } else if (this.pinnedInspector?.kind !== 'pressure') {
        this.focusedPressurePlateInstanceId = null;
      }
    }

    const source = this.getFocusedPressurePlateRef();
    if (!source) {
      this.renderInspectorUi();
      return;
    }

    const currentTarget = this.getCoursePressurePlateTargetRef(source);
    if (currentTarget) {
      this.drawPressurePlateLink(graphics, source, currentTarget, 0x6dd5ff, 0.9);
    }

    const sourceBounds = source.slice.runtime.getPlacedObjectBounds(source.placed);
    graphics.lineStyle(2, 0xc3f4ff, 0.88);
    graphics.strokeRoundedRect(
      sourceBounds.x,
      sourceBounds.y,
      sourceBounds.width,
      sourceBounds.height,
      6
    );

    if (this.connectingPressurePlateInstanceId === source.placed.instanceId) {
      const hoveredTargetPlaced = hoveredSlice?.runtime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) =>
          canPlacedObjectBePressurePlateTarget(placed) &&
          placed.instanceId !== source.placed.instanceId
      );
      const hoveredTarget =
        hoveredSlice && hoveredTargetPlaced
          ? { slice: hoveredSlice, placed: hoveredTargetPlaced }
          : null;
      const eligibleTargets = this.getCoursePressurePlateEligibleTargets(source);
      for (const target of eligibleTargets) {
        const bounds = target.slice.runtime.getPlacedObjectBounds(target.placed);
        graphics.lineStyle(
          2,
          hoveredTarget?.placed.instanceId === target.placed.instanceId ? 0x9dff8a : 0x7ad3ff,
          hoveredTarget?.placed.instanceId === target.placed.instanceId ? 0.95 : 0.55
        );
        graphics.strokeRoundedRect(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          6
        );
      }

      if (hoveredTarget) {
        this.drawPressurePlateLink(graphics, source, hoveredTarget, 0x9dff8a, 0.95);
      } else {
        graphics.lineStyle(2, 0xffd36b, 0.5);
        graphics.beginPath();
        graphics.moveTo(
          source.slice.origin.x + source.placed.x,
          source.slice.origin.y + source.placed.y - 4
        );
        graphics.lineTo(worldPoint.x, worldPoint.y);
        graphics.strokePath();
      }
    }

    this.renderInspectorUi();
  }

  updateContainerOverlay(graphics: Phaser.GameObjects.Graphics | null): void {
    graphics?.clear();
    if (
      !graphics ||
      editorState.isPlaying ||
      this.connectingPressurePlateInstanceId
    ) {
      this.renderInspectorUi();
      return;
    }

    const slice = this.host.getSelectedSlice();
    if (!slice) {
      this.renderInspectorUi();
      return;
    }

    if (
      this.focusedContainerInstanceId &&
      !slice.runtime.hasPlacedObjectInstanceId(this.focusedContainerInstanceId)
    ) {
      this.focusedContainerInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'container' &&
      !slice.runtime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }

    const pointer = this.scene.input.activePointer;
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const hoveredContainer = slice.runtime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectBeContainer(placed)
    );
    if (hoveredContainer) {
      if (this.focusedContainerInstanceId !== hoveredContainer.instanceId) {
        this.containerStatusText = null;
      }
      this.focusedContainerInstanceId = hoveredContainer.instanceId ?? null;
    } else if (this.pinnedInspector?.kind !== 'container') {
      this.focusedContainerInstanceId = null;
    }

    const focused = this.getFocusedContainer();
    if (!focused) {
      this.renderInspectorUi();
      return;
    }

    const bounds = slice.runtime.getPlacedObjectBounds(focused);
    const selectedObject = editorState.selectedObjectId
      ? getObjectById(editorState.selectedObjectId)
      : null;
    const canStoreSelected = canObjectBeStoredInContainer(focused.id, selectedObject);
    const selectedLooksLikeContents =
      selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
    const strokeColor = canStoreSelected
      ? 0x9dff8a
      : selectedLooksLikeContents
        ? 0xffc76b
        : 0xffe0a6;
    const strokeAlpha = canStoreSelected ? 0.92 : 0.74;
    graphics.lineStyle(2, strokeColor, strokeAlpha);
    graphics.strokeRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 6);
    graphics.fillStyle(strokeColor, 0.86);
    graphics.fillCircle(
      slice.origin.x + focused.x,
      slice.origin.y + focused.y - 6,
      3
    );

    this.renderInspectorUi();
  }

  private pinInspector(kind: 'pressure' | 'container', instanceId: string): void {
    this.pinnedInspector = { kind, instanceId };
  }

  private getCoursePressurePlateTargetRef(
    source: CoursePlacedObjectRef
  ): CoursePlacedObjectRef | null {
    const courseLink = getCoursePressurePlateLink(
      this.host.getActiveCourseDraft(),
      source.slice.roomId,
      source.placed.instanceId ?? '',
    );
    if (courseLink) {
      return this.getPlacedObjectRefByInstanceId(
        courseLink.targetInstanceId,
        courseLink.targetRoomId,
      );
    }

    return this.getPlacedObjectRefByInstanceId(
      source.placed.triggerTargetInstanceId ?? null,
      source.slice.roomId,
    );
  }

  private getCoursePressurePlateEligibleTargets(
    source: CoursePlacedObjectRef
  ): CoursePlacedObjectRef[] {
    const eligibleTargets: CoursePlacedObjectRef[] = [];
    for (const slice of this.host.getRoomSlices()) {
      for (const placed of slice.placedObjects) {
        if (
          canPlacedObjectBePressurePlateTarget(placed) &&
          placed.instanceId !== source.placed.instanceId
        ) {
          eligibleTargets.push({ slice, placed });
        }
      }
    }
    return eligibleTargets;
  }

  private setCoursePressurePlateTarget(
    source: CoursePlacedObjectRef,
    target: CoursePlacedObjectRef | null,
  ): boolean {
    if (!source.placed.instanceId) {
      return false;
    }

    const previousCourseLink = getCoursePressurePlateLink(
      this.host.getActiveCourseDraft(),
      source.slice.roomId,
      source.placed.instanceId,
    );
    let changed = false;

    if (!target || target.slice.roomId === source.slice.roomId) {
      changed =
        source.slice.runtime.setPressurePlateTarget(
          source.placed.instanceId,
          target?.placed.instanceId ?? null,
        ) || changed;
    } else {
      changed =
        source.slice.runtime.setPressurePlateTarget(source.placed.instanceId, null) || changed;
    }

    const draft = this.host.getActiveCourseDraft();
    if (!draft) {
      return changed;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (
      target &&
      target.slice.roomId !== source.slice.roomId &&
      target.placed.instanceId
    ) {
      setCoursePressurePlateLink(
        nextDraft,
        {
          triggerRoomId: source.slice.roomId,
          triggerInstanceId: source.placed.instanceId,
          targetRoomId: target.slice.roomId,
          targetInstanceId: target.placed.instanceId,
        },
        {
          triggerRoomId: source.slice.roomId,
          triggerInstanceId: source.placed.instanceId,
        },
      );
      changed =
        changed ||
        previousCourseLink?.targetRoomId !== target.slice.roomId ||
        previousCourseLink?.targetInstanceId !== target.placed.instanceId;
    } else {
      setCoursePressurePlateLink(
        nextDraft,
        null,
        {
          triggerRoomId: source.slice.roomId,
          triggerInstanceId: source.placed.instanceId,
        },
      );
      changed = changed || previousCourseLink !== null;
    }

    if (changed) {
      this.host.setActiveCourseDraft(nextDraft);
    }

    return changed;
  }

  private pruneCoursePressurePlateLinksForInstance(
    roomId: string,
    instanceId: string | null | undefined,
  ): void {
    if (!instanceId) {
      return;
    }

    const draft = this.host.getActiveCourseDraft();
    if (!draft) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    const previousCount = nextDraft.pressurePlateLinks.length;
    clearCoursePressurePlateLinksForInstance(nextDraft, roomId, instanceId);
    if (nextDraft.pressurePlateLinks.length !== previousCount) {
      this.host.setActiveCourseDraft(nextDraft);
    }
  }

  private getPressurePlateTargetSummary(
    target: CoursePlacedObjectRef,
    sourceSlice: CourseInspectorRoomSlice,
  ): string {
    const baseLabel = getPressurePlateTargetLabel(target.placed.id);
    return target.slice.roomId === sourceSlice.roomId
      ? baseLabel
      : `${baseLabel} in ${this.host.getSliceLabel(target.slice)}`;
  }

  private getFocusedPressurePlateRef(): CoursePlacedObjectRef | null {
    const pinnedPressureId = this.pinnedInspector?.kind === 'pressure'
      ? this.pinnedInspector.instanceId
      : null;
    const activeId =
      this.connectingPressurePlateInstanceId ?? pinnedPressureId ?? this.focusedPressurePlateInstanceId;
    const focused = this.getPlacedObjectRefByInstanceId(activeId);
    if (focused && canPlacedObjectTriggerOtherObjects(focused.placed)) {
      return focused;
    }

    return null;
  }

  private getFocusedContainer(): PlacedObject | null {
    const slice = this.host.getSelectedSlice();
    if (!slice) {
      return null;
    }

    const pinnedContainerId = this.pinnedInspector?.kind === 'container'
      ? this.pinnedInspector.instanceId
      : null;
    const focused = slice.runtime.getPlacedObjectByInstanceId(
      pinnedContainerId ?? this.focusedContainerInstanceId
    );
    if (focused && canPlacedObjectBeContainer(focused)) {
      return focused;
    }

    return null;
  }

  private getConnectingPressurePlateRef(): CoursePlacedObjectRef | null {
    const focused = this.getPlacedObjectRefByInstanceId(this.connectingPressurePlateInstanceId);
    if (focused && canPlacedObjectTriggerOtherObjects(focused.placed)) {
      return focused;
    }

    return null;
  }

  private beginPressurePlateConnection(triggerInstanceId: string, autoPlaced: boolean): void {
    const trigger = this.getPlacedObjectRefByInstanceId(triggerInstanceId);
    if (!trigger || !canPlacedObjectTriggerOtherObjects(trigger.placed)) {
      return;
    }

    this.focusedPressurePlateInstanceId = trigger.placed.instanceId ?? null;
    this.connectingPressurePlateInstanceId = trigger.placed.instanceId ?? null;
    this.pinInspector('pressure', trigger.placed.instanceId ?? '');
    const eligibleTargets = this.getCoursePressurePlateEligibleTargets(trigger);
    this.pressurePlateStatusText =
      eligibleTargets.length > 0
        ? autoPlaced
          ? 'Pressure plate placed. Click a door, cage, or chest to link it.'
          : 'Click a door, cage, or chest to link this pressure plate.'
        : 'No door, cage, or chest is in this course yet. You can link this pressure plate later.';
    this.renderInspectorUi();
  }

  private drawPressurePlateLink(
    graphics: Phaser.GameObjects.Graphics,
    source: CoursePlacedObjectRef,
    target: CoursePlacedObjectRef,
    color: number,
    alpha: number,
  ): void {
    graphics.lineStyle(2, color, alpha);
    graphics.beginPath();
    graphics.moveTo(
      source.slice.origin.x + source.placed.x,
      source.slice.origin.y + source.placed.y - 4,
    );
    graphics.lineTo(
      target.slice.origin.x + target.placed.x,
      target.slice.origin.y + target.placed.y - 6,
    );
    graphics.strokePath();
    graphics.fillStyle(color, alpha * 0.9);
    graphics.fillCircle(
      source.slice.origin.x + source.placed.x,
      source.slice.origin.y + source.placed.y - 4,
      3,
    );
    graphics.fillCircle(
      target.slice.origin.x + target.placed.x,
      target.slice.origin.y + target.placed.y - 6,
      3,
    );
  }

  private renderInspectorUi(): void {
    const hiddenState = createEmptyCourseInspectorState();
    if (editorState.isPlaying) {
      this.host.renderInspector(hiddenState);
      return;
    }

    const connectMode = this.connectingPressurePlateInstanceId !== null;
    const source =
      this.pinnedInspector?.kind === 'container' && !connectMode
        ? null
        : this.getFocusedPressurePlateRef();
    if (source && (editorState.paletteMode === 'objects' || connectMode)) {
      const target = this.getCoursePressurePlateTargetRef(source);
      this.host.renderInspector(
        buildPressurePlateInspectorState({
          statusText: this.pressurePlateStatusText,
          connectMode,
          targetSummary: target ? this.getPressurePlateTargetSummary(target, source.slice) : null,
          eligibleTargetCount: this.getCoursePressurePlateEligibleTargets(source).length,
        }),
      );
      return;
    }

    const slice = this.host.getSelectedSlice();
    if (!slice) {
      this.host.renderInspector(hiddenState);
      return;
    }

    const focusedContainer =
      this.pinnedInspector?.kind === 'pressure' && !connectMode
        ? null
        : this.getFocusedContainer();
    if (
      focusedContainer &&
      editorState.paletteMode === 'objects' &&
      !this.connectingPressurePlateInstanceId
    ) {
      const selectedObject = editorState.selectedObjectId
        ? getObjectById(editorState.selectedObjectId) ?? null
        : null;
      const selectedLooksLikeContents =
        selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
      const canStoreSelected = canObjectBeStoredInContainer(focusedContainer.id, selectedObject);
      const currentContentsLabel = slice.runtime.getContainerContentsLabel(focusedContainer);
      this.host.renderInspector(
        buildContainerInspectorState({
          containerObjectId: focusedContainer.id,
          statusText: this.containerStatusText,
          selectedObject,
          selectedLooksLikeContents,
          canStoreSelected,
          currentContentsLabel,
          hasContents: Boolean(focusedContainer.containedObjectId),
        }),
      );
      return;
    }

    this.host.renderInspector(hiddenState);
  }
}
