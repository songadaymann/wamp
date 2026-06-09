import Phaser from 'phaser';
import {
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  canPlacedObjectBeLinkedObjectTarget,
  canPlacedObjectBePressurePlateTarget,
  canPlacedObjectUseObjectLink,
  editorState,
  getObjectById,
  isMovingPlatformEndpointObjectId,
  isMovingPlatformObjectId,
  isPortalObjectId,
  type PlacedObject,
} from '../../config';
import {
  cloneCourseSnapshot,
  type CourseSnapshot,
} from '../../courses/model';
import {
  clearCourseObjectLinksForInstance,
  getCourseObjectLink,
  setCourseObjectLink,
} from '../../courses/objectLinks';
import { canPlacedObjectUseObjectPath } from '../../placedObjects/objectPaths';
import type { EditorEditRuntime } from '../editor/editRuntime';
import type { EditorInspectorState } from '../editor/uiBridge';
import {
  buildContainerInspectorState,
  buildPressurePlateInspectorState,
  createEmptyCourseInspectorState,
  getContainerAcceptedContentsLabel,
  getContainerName,
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
    if (!source || !canPlacedObjectUseObjectLink(source.placed)) {
      return;
    }

    if (this.setCourseObjectLinkTarget(source, null)) {
      this.pressurePlateStatusText = `${this.getObjectLinkSourceLabel(source.placed)} link cleared.`;
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
    const focused = this.getFocusedPressurePlateRef();
    this.pressurePlateStatusText = `${this.getObjectLinkSourceLabel(focused?.placed ?? null)} left unlinked for now.`;
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
    if (placed && canPlacedObjectUseObjectLink(placed)) {
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
    this.pruneCourseObjectLinksForInstance(roomId, removed.instanceId ?? null);

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
    if (canPlacedObjectBePressurePlateTarget(removed) || isMovingPlatformEndpointObjectId(removed.id)) {
      this.pressurePlateStatusText = `${this.getObjectLinkTargetLabel(removed.id)} removed. Linked objects were cleared.`;
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
        this.canUseObjectLinkTarget(source, { slice, placed })
    );
    if (!target) {
      this.pressurePlateStatusText = this.getObjectLinkPickTargetStatus(source.placed);
      this.renderInspectorUi();
      return true;
    }

    if (canPlacedObjectUseObjectPath(source.placed) && slice.roomId === source.slice.roomId) {
      const toggleResult = source.slice.runtime.toggleObjectPathTarget(
        source.placed.instanceId ?? '',
        target.instanceId,
      );
      if (toggleResult !== 'unchanged') {
        this.clearCourseObjectLinkForSource(source);
        this.connectingPressurePlateInstanceId = source.placed.instanceId ?? null;
        this.focusedPressurePlateInstanceId = source.placed.instanceId ?? null;
        this.pinInspector('pressure', source.placed.instanceId ?? '');
        const targetCount = source.slice.runtime.getObjectPathTargetIds(source.placed.instanceId).length;
        this.pressurePlateStatusText =
          toggleResult === 'added'
            ? `Added ${this.getObjectLinkTargetLabel(target.id)} stop ${targetCount}. Click another anchor, or use Done Later.`
            : `Removed ${this.getObjectLinkTargetLabel(target.id)} from the path. Click another anchor, or use Done Later.`;
        this.renderInspectorUi();
      }
      return true;
    }

    if (
      this.setCourseObjectLinkTarget(source, {
        slice,
        placed: target,
      })
    ) {
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = source.placed.instanceId ?? null;
      this.pinInspector('pressure', source.placed.instanceId ?? '');
      this.pressurePlateStatusText =
        `${this.getObjectLinkSourceLabel(source.placed)} linked to ${this.getObjectLinkTargetSummary({ slice, placed: target }, source.slice)}.`;
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
        (placed) => canPlacedObjectUseObjectLink(placed)
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

    const currentTargets = this.getCourseObjectLinkTargetRefs(source);
    this.drawObjectLinkPath(graphics, source, currentTargets, 0x6dd5ff, 0.9);

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
      let hoveredTarget: CoursePlacedObjectRef | null = null;
      if (hoveredSlice) {
        const hoveredTargetPlaced = hoveredSlice.runtime.findPlacedObjectAt(
          worldPoint.x,
          worldPoint.y,
          (placed) => this.canUseObjectLinkTarget(source, { slice: hoveredSlice, placed })
        );
        hoveredTarget = hoveredTargetPlaced
          ? { slice: hoveredSlice, placed: hoveredTargetPlaced }
          : null;
      }
      const eligibleTargets = this.getCourseObjectLinkEligibleTargets(source);
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
        this.drawPressurePlateLink(
          graphics,
          this.getObjectLinkPreviewSource(source, currentTargets, hoveredTarget),
          hoveredTarget,
          0x9dff8a,
          0.95,
        );
      } else {
        const previewSource = this.getObjectLinkPreviewSource(source, currentTargets, null);
        graphics.lineStyle(2, 0xffd36b, 0.5);
        graphics.beginPath();
        graphics.moveTo(
          previewSource.slice.origin.x + previewSource.placed.x,
          previewSource.slice.origin.y + previewSource.placed.y - 4
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

  private getCourseObjectLinkTargetRefs(
    source: CoursePlacedObjectRef
  ): CoursePlacedObjectRef[] {
    if (canPlacedObjectUseObjectLink(source.placed)) {
      const courseLink = getCourseObjectLink(
        this.host.getActiveCourseDraft(),
        source.slice.roomId,
        source.placed.instanceId ?? '',
      );
      if (courseLink) {
        const target = this.getPlacedObjectRefByInstanceId(
          courseLink.targetInstanceId,
          courseLink.targetRoomId,
        );
        return target ? [target] : [];
      }

      if (canPlacedObjectUseObjectPath(source.placed)) {
        return source.slice.runtime
          .getObjectPathTargets(source.placed.instanceId)
          .map((placed) => ({ slice: source.slice, placed }));
      }
    }

    const localTarget = this.getPlacedObjectRefByInstanceId(
      source.placed.triggerTargetInstanceId ?? null,
      source.slice.roomId,
    );
    return localTarget ? [localTarget] : [];
  }

  private getCourseObjectLinkEligibleTargets(
    source: CoursePlacedObjectRef
  ): CoursePlacedObjectRef[] {
    const eligibleTargets: CoursePlacedObjectRef[] = [];
    const slices = canPlacedObjectUseObjectLink(source.placed)
      ? this.host.getRoomSlices()
      : [source.slice];
    for (const slice of slices) {
      for (const placed of slice.placedObjects) {
        const target = { slice, placed };
        if (this.canUseObjectLinkTarget(source, target)) {
          eligibleTargets.push({ slice, placed });
        }
      }
    }
    return eligibleTargets;
  }

  private setCourseObjectLinkTarget(
    source: CoursePlacedObjectRef,
    target: CoursePlacedObjectRef | null,
  ): boolean {
    if (!source.placed.instanceId) {
      return false;
    }

    if (!canPlacedObjectUseObjectLink(source.placed)) {
      if (target && target.slice.roomId !== source.slice.roomId) {
        return false;
      }
      return source.slice.runtime.setObjectLinkTarget(
        source.placed.instanceId,
        target?.placed.instanceId ?? null,
      );
    }

    const previousCourseLink = getCourseObjectLink(
      this.host.getActiveCourseDraft(),
      source.slice.roomId,
      source.placed.instanceId,
    );
    let changed = false;

    const localTargetInstanceId =
      target?.slice.roomId === source.slice.roomId
        ? target.placed.instanceId ?? null
        : null;
    changed =
      source.slice.runtime.setPressurePlateTarget(
        source.placed.instanceId,
        localTargetInstanceId,
      ) || changed;

    const draft = this.host.getActiveCourseDraft();
    if (!draft) {
      return changed;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (target && target.placed.instanceId) {
      setCourseObjectLink(
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
      setCourseObjectLink(
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

  private pruneCourseObjectLinksForInstance(
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
    const previousCount = nextDraft.objectLinks.length;
    clearCourseObjectLinksForInstance(nextDraft, roomId, instanceId);
    if (nextDraft.objectLinks.length !== previousCount) {
      this.host.setActiveCourseDraft(nextDraft);
    }
  }

  private clearCourseObjectLinkForSource(source: CoursePlacedObjectRef): boolean {
    if (!source.placed.instanceId) {
      return false;
    }

    const draft = this.host.getActiveCourseDraft();
    if (!draft) {
      return false;
    }

    const previousCourseLink = getCourseObjectLink(
      draft,
      source.slice.roomId,
      source.placed.instanceId,
    );
    if (!previousCourseLink) {
      return false;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    setCourseObjectLink(
      nextDraft,
      null,
      {
        triggerRoomId: source.slice.roomId,
        triggerInstanceId: source.placed.instanceId,
      },
    );
    this.host.setActiveCourseDraft(nextDraft);
    return true;
  }

  private getObjectLinkTargetSummary(
    target: CoursePlacedObjectRef,
    sourceSlice: CourseInspectorRoomSlice,
  ): string {
    const baseLabel = this.getObjectLinkTargetLabel(target.placed.id);
    return target.slice.roomId === sourceSlice.roomId
      ? baseLabel
      : `${baseLabel} in ${this.host.getSliceLabel(target.slice)}`;
  }

  private getObjectLinkTargetsSummary(
    source: CoursePlacedObjectRef,
    targets: CoursePlacedObjectRef[],
  ): string | null {
    if (targets.length === 0) {
      return null;
    }

    if (canPlacedObjectUseObjectPath(source.placed) && targets.length > 1) {
      return `${targets.length} Moving Platform Anchor stops`;
    }

    return this.getObjectLinkTargetSummary(targets[0], source.slice);
  }

  private canUseObjectLinkTarget(
    source: CoursePlacedObjectRef,
    target: CoursePlacedObjectRef,
  ): boolean {
    return (
      target.placed.instanceId !== source.placed.instanceId &&
      canPlacedObjectBeLinkedObjectTarget(source.placed, target.placed)
    );
  }

  private getObjectLinkSourceLabel(source: PlacedObject | null): string {
    if (source && isMovingPlatformObjectId(source.id)) {
      return 'Moving platform';
    }
    if (source && isPortalObjectId(source.id)) {
      return getObjectById(source.id)?.name ?? 'Portal';
    }

    return 'Pressure plate';
  }

  private getObjectLinkConnectStatus(source: PlacedObject, eligibleTargetCount: number): string {
    if (eligibleTargetCount <= 0) {
      return this.getObjectLinkNoTargetsStatus(source);
    }

    return this.getObjectLinkPickTargetStatus(source);
  }

  private getObjectLinkBeginStatus(source: PlacedObject, autoPlaced: boolean): string {
    if (isMovingPlatformObjectId(source.id)) {
      return autoPlaced
        ? 'Moving platform placed. Click Moving Platform Anchors to add path stops.'
        : 'Click Moving Platform Anchors to add or remove path stops.';
    }
    if (isPortalObjectId(source.id)) {
      const sourceLabel = this.getObjectLinkSourceLabel(source);
      return autoPlaced
        ? `${sourceLabel} placed. Click the opposite portal to connect it.`
        : `Click the opposite portal to connect this ${sourceLabel}.`;
    }

    return autoPlaced
      ? 'Pressure plate placed. Click a door, barricade, cage, or chest to link it.'
      : 'Click a door, barricade, cage, or chest to link this pressure plate.';
  }

  private getObjectLinkPickTargetStatus(source: PlacedObject): string {
    if (isMovingPlatformObjectId(source.id)) {
      return 'Pick Moving Platform Anchors in this expanded room.';
    }
    if (isPortalObjectId(source.id)) {
      return 'Pick the opposite portal in this expanded room.';
    }
    return 'Pick a door, barricade, cage, or chest in this expanded room.';
  }

  private getObjectLinkNoTargetsStatus(source: PlacedObject): string {
    if (isMovingPlatformObjectId(source.id)) {
      return 'No Moving Platform Anchor is in this expanded room yet. You can link this moving platform later.';
    }
    if (isPortalObjectId(source.id)) {
      return 'No opposite portal is in this expanded room yet. You can link this portal later.';
    }
    return 'No door, barricade, cage, or chest is in this expanded room yet. You can link this pressure plate later.';
  }

  private getObjectLinkNoTargetsTitle(source: PlacedObject): string {
    if (isMovingPlatformObjectId(source.id)) {
      return 'Add a Moving Platform Anchor to this expanded room first.';
    }
    if (isPortalObjectId(source.id)) {
      return 'Add the opposite portal to this expanded room first.';
    }
    return 'Add a door, barricade, cage, or chest to this expanded room first.';
  }

  private getObjectLinkTargetLabel(objectId: string): string {
    if (isMovingPlatformEndpointObjectId(objectId)) {
      return 'Moving Platform Anchor';
    }
    if (isPortalObjectId(objectId)) {
      return getObjectById(objectId)?.name ?? 'Portal';
    }

    switch (objectId) {
      case 'door_locked':
        return 'door';
      case 'door_locked_narrow':
        return 'narrow wooden door';
      case 'door_metal':
        return 'metal door';
      case 'door_metal_narrow':
        return 'narrow metal door';
      case 'treasure_chest':
        return 'treasure chest';
      case 'cage':
        return 'cage';
      case 'trapdoor_metal':
        return 'metal trapdoor';
      case 'trapdoor_locked':
        return 'locked trapdoor';
      case 'blast_door':
        return 'blast door';
      case 'barricade':
        return 'barricade';
      case 'wooden_bridge':
        return 'wooden bridge';
      default:
        return getObjectById(objectId)?.name ?? 'object';
    }
  }

  private getFocusedPressurePlateRef(): CoursePlacedObjectRef | null {
    const pinnedPressureId = this.pinnedInspector?.kind === 'pressure'
      ? this.pinnedInspector.instanceId
      : null;
    const activeId =
      this.connectingPressurePlateInstanceId ?? pinnedPressureId ?? this.focusedPressurePlateInstanceId;
    const focused = this.getPlacedObjectRefByInstanceId(activeId);
    if (focused && canPlacedObjectUseObjectLink(focused.placed)) {
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
    if (focused && canPlacedObjectUseObjectLink(focused.placed)) {
      return focused;
    }

    return null;
  }

  private beginPressurePlateConnection(triggerInstanceId: string, autoPlaced: boolean): void {
    const trigger = this.getPlacedObjectRefByInstanceId(triggerInstanceId);
    if (!trigger || !canPlacedObjectUseObjectLink(trigger.placed)) {
      return;
    }

    this.focusedPressurePlateInstanceId = trigger.placed.instanceId ?? null;
    this.connectingPressurePlateInstanceId = trigger.placed.instanceId ?? null;
    this.pinInspector('pressure', trigger.placed.instanceId ?? '');
    const eligibleTargets = this.getCourseObjectLinkEligibleTargets(trigger);
    this.pressurePlateStatusText =
      eligibleTargets.length > 0
        ? this.getObjectLinkBeginStatus(trigger.placed, autoPlaced)
        : this.getObjectLinkNoTargetsStatus(trigger.placed);
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

  private drawObjectLinkPath(
    graphics: Phaser.GameObjects.Graphics,
    source: CoursePlacedObjectRef,
    targets: CoursePlacedObjectRef[],
    color: number,
    alpha: number,
  ): void {
    let previous = source;
    for (const target of targets) {
      this.drawPressurePlateLink(graphics, previous, target, color, alpha);
      previous = target;
    }
  }

  private getObjectLinkPreviewSource(
    source: CoursePlacedObjectRef,
    currentTargets: CoursePlacedObjectRef[],
    hoveredTarget: CoursePlacedObjectRef | null,
  ): CoursePlacedObjectRef {
    if (!canPlacedObjectUseObjectPath(source.placed)) {
      return source;
    }

    const pathTargets = hoveredTarget
      ? currentTargets.filter((target) => target.placed.instanceId !== hoveredTarget.placed.instanceId)
      : currentTargets;
    return pathTargets[pathTargets.length - 1] ?? source;
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
      const targets = this.getCourseObjectLinkTargetRefs(source);
      const targetSummary = this.getObjectLinkTargetsSummary(source, targets);
      const eligibleTargetCount = this.getCourseObjectLinkEligibleTargets(source).length;
      this.host.renderInspector(
        buildPressurePlateInspectorState({
          statusText:
            this.pressurePlateStatusText ??
            (connectMode
              ? this.getObjectLinkConnectStatus(source.placed, eligibleTargetCount)
              : targetSummary
                ? `${this.getObjectLinkSourceLabel(source.placed)} linked to ${targetSummary}.`
                : `${this.getObjectLinkSourceLabel(source.placed)} is not linked yet.`),
          connectMode,
          targetSummary,
          eligibleTargetCount,
          connectTitle: this.getObjectLinkNoTargetsTitle(source.placed),
          allowReconnectWithTarget: canPlacedObjectUseObjectPath(source.placed),
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
