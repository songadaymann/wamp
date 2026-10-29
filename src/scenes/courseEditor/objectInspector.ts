import { EditorInspectorCore } from '../editor/inspectorCore';
import { EditorObjectLinkCopy } from '../editor/objectLinkCopy';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { buildActorInspectorState, isInspectorActor } from '../editor/actorInspectorViewModel';
import type { NpcMode } from '../../npcs/model';
import type { PoliceBehaviorMode } from '../../enemies/policeEnemy';
import type { SwordsmanDefeatMode, SwordsmanObjectiveMode } from '../../enemies/swordsmanObjectives';
import Phaser from 'phaser';
import { canConfigureCoopPlate, isCoopPressurePlate } from '../../placedObjects/coopPressurePlates';
import {
  canPlacedObjectBeContainer,
  canPlacedObjectBeLinkedObjectTarget,
  canPlacedObjectBePressurePlateTarget,
  canPlacedObjectTriggerOtherObjects,
  canPlacedObjectUseObjectLink,
  editorState,
  isMovingPlatformEndpointObjectId,
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
import { getRoomVideo } from '../../roomVideo/editing';
import { isRoomVideoLinkTarget } from '../../roomVideo/link';
import type { EditorEditRuntime } from '../editor/editRuntime';
import type { EditorInspectorState } from '../editor/uiBridge';
import {
  buildContainerInspectorState,
  canStoreEditorContainerContents,
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
  private readonly linkCopy = new EditorObjectLinkCopy(source => {
    const slice = this.getPlacedObjectRefByInstanceId(source.instanceId ?? null)?.slice;
    return { scope: 'expanded room', videoAnchor: Boolean(slice && getRoomVideo(slice.runtime)?.trigger) };
  });
  private readonly core = new EditorInspectorCore<CoursePlacedObjectRef>({
    placed: ref => ref.placed, runtime: ref => ref.slice.runtime, origin: ref => ref.slice.origin,
    connecting: () => this.getConnectingPressurePlateRef(),
    findAt: (world, predicate) => {
      const slice = this.host.getSliceAtWorldPoint(world.x, world.y);
      if (!slice) return null;
      const placed = slice.runtime.findPlacedObjectAt(world.x, world.y, item => predicate({ slice, placed: item }));
      return placed ? { slice, placed } : null;
    },
    targets: source => this.getCourseObjectLinkTargetRefs(source),
    eligibleTargets: source => this.getCourseObjectLinkEligibleTargets(source),
    setLinkTarget: (source, target) => this.setCourseObjectLinkTarget(source, target),
    clearLink: source => this.setCourseObjectLinkTarget(source, null),
    clearCrossLink: source => { this.clearCourseObjectLinkForSource(source); },
    prune: (scope, id) => this.pruneCourseObjectLinksForInstance(scope, id),
    targetSummary: (source, target) => this.getObjectLinkTargetSummary(target, source.slice),
    connectionChanged: (source, status, keep) => {
      const id = source.placed.instanceId ?? '';
      this.connectingPressurePlateInstanceId = keep ? id : null;
      this.focusedPressurePlateInstanceId = id; this.pinInspector('pressure', id); this.pressurePlateStatusText = status;
    },
    clearConnecting: () => { this.connectingPressurePlateInstanceId = null; },
    containerFocused: (ref, status) => {
      this.focusedContainerInstanceId = ref.placed.instanceId ?? null; this.focusedPressurePlateInstanceId = null;
      this.pinInspector('container', ref.placed.instanceId ?? '');
      if (status !== undefined) this.containerStatusText = status;
    },
    render: () => this.renderInspectorUi(), zoom: () => this.scene.cameras.main.zoom || 1, copy: this.linkCopy,
  });
  private focusedPressurePlateInstanceId: string | null = null;
  private connectingPressurePlateInstanceId: string | null = null;
  private pressurePlateStatusText: string | null = null;
  private focusedContainerInstanceId: string | null = null;
  private containerStatusText: string | null = null;
  private pinnedInspector: { kind: 'pressure' | 'container' | 'actor'; instanceId: string } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: CourseEditorObjectInspectorHost,
  ) {}

  isConnectingPressurePlate(): boolean {
    return this.connectingPressurePlateInstanceId !== null;
  }

  setFocusedCoopPlate(enabled: boolean): void {
    const ref = this.getFocusedPressurePlateRef();
    if (ref && ref.slice.runtime.setCoopPlate(ref.placed.instanceId, enabled)) {
      this.pressurePlateStatusText = enabled
        ? 'Co-op plate: other live players can hold it. Expanded Room clears stay practice.'
        : 'Solo plate: your character, crates and enemies can press it.';
    }
    this.renderInspectorUi();
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
    this.core.clearLink(this.getFocusedPressurePlateRef());
  }

  cancelPressurePlateConnection(): void {
    if (!this.connectingPressurePlateInstanceId) {
      return;
    }

    this.connectingPressurePlateInstanceId = null;
    const focused = this.getFocusedPressurePlateRef();
    this.pressurePlateStatusText = `${this.linkCopy.sourceLabel(focused?.placed ?? null)} left unlinked for now.`;
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

  private editFocusedActor(edit: (runtime: EditorEditRuntime, instanceId: string) => boolean): void {
    if (this.pinnedInspector?.kind !== 'actor') return;
    const ref = this.getPlacedObjectRefByInstanceId(this.pinnedInspector.instanceId);
    if (ref && isInspectorActor(ref.placed) && edit(ref.slice.runtime, ref.placed.instanceId ?? '')) this.renderInspectorUi();
  }

  setFocusedSwordsmanObjectiveMode(objectiveMode: SwordsmanObjectiveMode): void {
    this.editFocusedActor((runtime, id) => runtime.setSwordsmanObjectiveMode(id, objectiveMode));
  }

  setFocusedSwordsmanDefeatMode(defeatMode: SwordsmanDefeatMode): void {
    this.editFocusedActor((runtime, id) => runtime.setSwordsmanDefeatMode(id, defeatMode));
  }

  setFocusedBossHitPoints(value: number | null): void {
    this.editFocusedActor((runtime, id) => runtime.setBossHitPoints(id, value));
  }

  setFocusedPoliceBehaviorMode(mode: PoliceBehaviorMode): void {
    this.editFocusedActor((runtime, id) => runtime.setPoliceBehaviorMode(id, mode));
  }

  setFocusedPolicePatrolShoots(shoots: boolean): void {
    this.editFocusedActor((runtime, id) => runtime.setPolicePatrolShoots(id, shoots));
  }

  setFocusedNpcMode(mode: NpcMode): void {
    this.editFocusedActor((runtime, id) => runtime.setNpcMode(id, mode));
  }

  setFocusedNpcPushable(value: boolean): void {
    this.editFocusedActor((runtime, id) => runtime.setNpcPushable(id, value));
  }

  setFocusedNpcCanJumpFall(value: boolean): void {
    this.editFocusedActor((runtime, id) => runtime.setNpcCanJumpFall(id, value));
  }

  setFocusedNpcPlayerCollision(value: boolean): void {
    this.editFocusedActor((runtime, id) => runtime.setNpcPlayerCollision(id, value));
  }

  setFocusedNpcFriendlyFire(value: boolean): void {
    this.editFocusedActor((runtime, id) => runtime.setNpcFriendlyFire(id, value));
  }

  setFocusedNpcName(name: string): void {
    this.editFocusedActor((runtime, id) => runtime.setNpcName(id, name));
  }

  setFocusedNpcDialogue(text: string): void {
    this.editFocusedActor((runtime, id) => runtime.setNpcDialogue(id, text));
  }

  setFocusedNpcDefeatMode(mode: SwordsmanDefeatMode): void {
    this.editFocusedActor((runtime, id) => runtime.setNpcDefeatMode(id, mode));
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

  handleActorPrimaryAction(slice: CourseInspectorRoomSlice, worldX: number, worldY: number): boolean {
    const actor = slice.runtime.findPlacedObjectAt(worldX, worldY, isInspectorActor);
    if (!actor?.instanceId) return false;
    this.clearTransientState();
    this.pinInspector('actor', actor.instanceId);
    this.renderInspectorUi();
    return true;
  }

  handleObjectPlaced(placed: PlacedObject | null): boolean {
    if (placed?.instanceId && isInspectorActor(placed)) {
      this.clearTransientState();
      this.pinInspector('actor', placed.instanceId);
      this.renderInspectorUi();
      return true;
    }
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
    this.core.pruneRemoved(roomId, removed.instanceId);

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
      this.pressurePlateStatusText = `${this.linkCopy.targetLabel(removed.id)} removed. Linked objects were cleared.`;
    }
    if (canPlacedObjectBeContainer(removed)) {
      this.containerStatusText = `${getContainerName(removed.id)} removed.`;
    }
  }

  handlePressurePlateConnectionClick(_slice: CourseInspectorRoomSlice, worldX: number, worldY: number): boolean {
    return this.core.clickConnection({ x: worldX, y: worldY });
  }

  handleContainerContentsClick(_slice: CourseInspectorRoomSlice, worldX: number, worldY: number): boolean {
    return this.core.clickContainer({ x: worldX, y: worldY });
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

    this.core.drawPressureOverlay(graphics, this.getFocusedPressurePlateRef(), worldPoint);
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

    this.core.drawContainerOverlay(graphics, { slice, placed: focused });
    this.renderInspectorUi();
  }

  private pinInspector(kind: 'pressure' | 'container' | 'actor', instanceId: string): void {
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
    const baseLabel = this.linkCopy.targetLabel(target.placed.id);
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
        ? this.linkCopy.beginStatus(trigger.placed, autoPlaced)
        : this.linkCopy.noTargetsStatus(trigger.placed);
    this.renderInspectorUi();
  }

  private renderInspectorUi(): void {
    const render = (state: EditorInspectorState) => this.host.renderInspector({
      ...state,
      pinned: this.pinnedInspector !== null,
      connecting: this.connectingPressurePlateInstanceId !== null,
      selectionId: this.connectingPressurePlateInstanceId ?? this.pinnedInspector?.instanceId ?? null,
    });
    const hiddenState = createEmptyCourseInspectorState();
    if (editorState.isPlaying) {
      render(hiddenState);
      return;
    }

    if (this.pinnedInspector?.kind === 'actor') {
      const ref = this.getPlacedObjectRefByInstanceId(this.pinnedInspector.instanceId);
      const state = ref ? buildActorInspectorState(ref.placed) : null;
      if (state && editorState.paletteMode === 'objects') { render(state); return; }
      this.pinnedInspector = null;
    }

    const connectMode = this.connectingPressurePlateInstanceId !== null;
    const source =
      this.pinnedInspector?.kind === 'container' && !connectMode
        ? null
        : this.getFocusedPressurePlateRef();
    if (source && (editorState.paletteMode === 'objects' || connectMode)) {
      const targets = this.getCourseObjectLinkTargetRefs(source);
      const targetSummary = this.getObjectLinkTargetsSummary(source, targets);
      const eligibleTargetCount = this.getCourseObjectLinkEligibleTargets(source).length
        + (canPlacedObjectTriggerOtherObjects(source.placed) && getRoomVideo(source.slice.runtime)?.trigger ? 1 : 0);
      const videoLinked = canPlacedObjectTriggerOtherObjects(source.placed)
        && isRoomVideoLinkTarget(source.placed.triggerTargetInstanceId);
      const linkedSummary = targetSummary
        ?? (videoLinked ? `${this.linkCopy.sourceLabel(source.placed)} linked to the video.` : null);
      render(
        buildPressurePlateInspectorState({
          statusText:
            this.pressurePlateStatusText ??
            (connectMode
              ? this.linkCopy.connectStatus(source.placed, eligibleTargetCount)
              : linkedSummary
                ?? `${this.linkCopy.sourceLabel(source.placed)} is not linked yet.`),
          connectMode,
          targetSummary: linkedSummary,
          eligibleTargetCount,
          connectTitle: this.linkCopy.noTargetsTitle(source.placed),
          allowReconnectWithTarget: canPlacedObjectUseObjectPath(source.placed),
          coopAvailable: canConfigureCoopPlate(source.placed),
          coopPlate: isCoopPressurePlate(source.placed),
        }),
      );
      return;
    }

    const slice = this.host.getSelectedSlice();
    if (!slice) {
      render(hiddenState);
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
        ? getEditorObjectConfigById(editorState.selectedObjectId) ?? null
        : null;
      const selectedLooksLikeContents =
        selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
      const canStoreSelected = canStoreEditorContainerContents(focusedContainer.id, selectedObject);
      const currentContentsLabel = slice.runtime.getContainerContentsLabel(focusedContainer);
      render(
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

    render(hiddenState);
  }
}
