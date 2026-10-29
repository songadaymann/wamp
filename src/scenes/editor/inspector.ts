import { EditorInspectorCore } from './inspectorCore';
import { EditorObjectLinkCopy } from './objectLinkCopy';
import { buildActorInspectorState } from './actorInspectorViewModel';
import { canConfigureCoopPlate, isCoopPressurePlate } from '../../placedObjects/coopPressurePlates';
import Phaser from 'phaser';
import {
  canPlacedObjectBeContainer,
  canPlacedObjectBePressurePlateTarget,
  canPlacedObjectTriggerOtherObjects,
  canPlacedObjectUseObjectLink,
  editorState,
  getObjectById,
  isMovingPlatformEndpointObjectId,
  type PlacedObject,
} from '../../config';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { getRoomVideo } from '../../roomVideo/editing';
import { isRoomVideoLinkTarget } from '../../roomVideo/link';
import { SWORDSMAN_AI_OBJECT_ID } from '../../enemies/swordsmanAi';
import {
  DEFAULT_POLICE_BEHAVIOR_MODE,
  POLICE_BEHAVIOR_MODE_LABELS,
  isPoliceEnemyObjectId,
  normalizePoliceBehaviorMode,
  type PoliceBehaviorMode,
} from '../../enemies/policeEnemy';
import {
  DEFAULT_SWORDSMAN_DEFEAT_MODE,
  DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
  SWORDSMAN_DEFEAT_MODE_LABELS,
  SWORDSMAN_OBJECTIVE_MODE_LABELS,
  normalizeSwordsmanDefeatMode,
  normalizeSwordsmanObjectiveMode,
  type SwordsmanDefeatMode,
  type SwordsmanObjectiveMode,
} from '../../enemies/swordsmanObjectives';
import { requestSignTextEdit } from '../../signs/events';
import { canPlacedObjectHaveSignText, getPlacedObjectSignText } from '../../signs/model';
import { canPlacedObjectUseObjectPath } from '../../placedObjects/objectPaths';
import { type EditorEditRuntime } from './editRuntime';
import type { EditorInspectorState } from './uiBridge';
import {
  NPC_MODE_LABELS,
  isNpcObjectId,
  type NpcMode,
} from '../../npcs/model';
import {
  buildContainerInspectorState,
  canStoreEditorContainerContents,
  buildPressurePlateInspectorState,
  createEmptyEditorInspectorState,
  getContainerAcceptedContentsLabel,
  getContainerName,
} from './inspectorViewModel';

type PinnedInspector = { kind: 'pressure' | 'container' | 'swordsman' | 'police' | 'npc'; instanceId: string } | null;

export class EditorInspectorController {
  private readonly linkCopy = new EditorObjectLinkCopy(() => ({
    scope: 'room', videoAnchor: Boolean(getRoomVideo(this.editRuntime)?.trigger),
  }));
  private readonly core = new EditorInspectorCore<PlacedObject>({
    placed: ref => ref, runtime: () => this.editRuntime, origin: () => ({ x: 0, y: 0 }),
    connecting: () => this.getConnectingPressurePlate(),
    findAt: (world, predicate) => this.editRuntime.findPlacedObjectAt(world.x, world.y, predicate),
    targets: source => this.getObjectLinkTargets(source),
    eligibleTargets: source => this.editRuntime.getObjectLinkEligibleTargets(source.instanceId),
    setLinkTarget: (source, target) => this.editRuntime.setObjectLinkTarget(source.instanceId, target.instanceId),
    clearLink: source => this.editRuntime.setObjectLinkTarget(source.instanceId, null),
    clearCrossLink: () => {}, prune: () => {},
    targetSummary: (_source, target) => this.linkCopy.targetLabel(target.id),
    connectionChanged: (source, status, keep) => {
      this.connectingPressurePlateInstanceId = keep ? source.instanceId : null;
      this.focusedPressurePlateInstanceId = source.instanceId;
      this.pressurePlateStatusText = status; this.pinInspector('pressure', source.instanceId);
    },
    clearConnecting: () => { this.connectingPressurePlateInstanceId = null; },
    containerFocused: (ref, status) => {
      this.focusedContainerInstanceId = ref.instanceId; this.focusedPressurePlateInstanceId = null;
      this.focusedSwordsmanInstanceId = null; this.pinInspector('container', ref.instanceId);
      if (status !== undefined) this.containerStatusText = status;
    },
    render: () => this.renderInspectorUi(), zoom: () => this.scene.cameras.main.zoom || 1, copy: this.linkCopy,
  });
  private focusedPressurePlateInstanceId: string | null = null;
  private connectingPressurePlateInstanceId: string | null = null;
  private pressurePlateStatusText: string | null = null;
  private focusedContainerInstanceId: string | null = null;
  private containerStatusText: string | null = null;
  private focusedSwordsmanInstanceId: string | null = null;
  private swordsmanStatusText: string | null = null;
  private focusedPoliceInstanceId: string | null = null;
  private policeStatusText: string | null = null;
  private focusedNpcInstanceId: string | null = null;
  private npcStatusText: string | null = null;
  private pinnedInspector: PinnedInspector = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly editRuntime: EditorEditRuntime,
    private readonly renderInspector: (state: EditorInspectorState) => void,
  ) {}

  isConnectingPressurePlate(): boolean {
    return this.connectingPressurePlateInstanceId !== null;
  }

  setFocusedCoopPlate(enabled: boolean): void {
    const placed = this.getFocusedPressurePlate();
    if (placed && this.editRuntime.setCoopPlate(placed.instanceId, enabled)) {
      this.pressurePlateStatusText = enabled
        ? 'Co-op plate: other live players can hold it. Room clears stay practice.'
        : 'Solo plate: your character, crates and enemies can press it.';
    }
    this.renderInspectorUi();
  }

  hasPinnedInspector(): boolean {
    return this.pinnedInspector !== null;
  }

  refreshUi(): void {
    this.renderInspectorUi();
  }

  reset(): void {
    this.clearTransientObjectInspectorState();
    this.renderInspectorUi();
  }

  hideTransientUi(): void {
    this.clearTransientObjectInspectorState();
    this.renderInspector(createEmptyEditorInspectorState());
  }

  private clearTransientObjectInspectorState(): void {
    this.focusedPressurePlateInstanceId = null;
    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = null;
    this.focusedContainerInstanceId = null;
    this.containerStatusText = null;
    this.focusedSwordsmanInstanceId = null;
    this.swordsmanStatusText = null;
    this.focusedPoliceInstanceId = null;
    this.policeStatusText = null;
    this.focusedNpcInstanceId = null;
    this.npcStatusText = null;
    this.pinnedInspector = null;
  }

  updatePressurePlateOverlay(graphics: Phaser.GameObjects.Graphics | null): void {
    graphics?.clear();
    if (!graphics || editorState.isPlaying) {
      this.renderPressurePlatePanel();
      return;
    }

    if (
      this.focusedPressurePlateInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.focusedPressurePlateInstanceId)
    ) {
      this.focusedPressurePlateInstanceId = null;
    }
    if (
      this.connectingPressurePlateInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.connectingPressurePlateInstanceId)
    ) {
      this.connectingPressurePlateInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'pressure' &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }

    const pointer = this.scene.input.activePointer;
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (!this.connectingPressurePlateInstanceId) {
      const hoveredTrigger = this.editRuntime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) => canPlacedObjectUseObjectLink(placed),
      );
      if (hoveredTrigger) {
        if (this.focusedPressurePlateInstanceId !== hoveredTrigger.instanceId) {
          this.pressurePlateStatusText = null;
        }
        this.focusedPressurePlateInstanceId = hoveredTrigger.instanceId;
      } else if (this.pinnedInspector?.kind !== 'pressure') {
        this.focusedPressurePlateInstanceId = null;
      }
    }

    this.core.drawPressureOverlay(graphics, this.getFocusedPressurePlate(), worldPoint);
    this.renderPressurePlatePanel();
  }

  updateContainerOverlay(graphics: Phaser.GameObjects.Graphics | null): void {
    graphics?.clear();
    if (!graphics || editorState.isPlaying || this.connectingPressurePlateInstanceId) {
      this.renderContainerContentsPanel();
      return;
    }

    if (
      this.focusedContainerInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.focusedContainerInstanceId)
    ) {
      this.focusedContainerInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'container' &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }
    if (
      this.focusedSwordsmanInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.focusedSwordsmanInstanceId)
    ) {
      this.focusedSwordsmanInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'swordsman' &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }
    if (
      this.focusedPoliceInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.focusedPoliceInstanceId)
    ) {
      this.focusedPoliceInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'police' &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }
    if (
      this.focusedNpcInstanceId &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.focusedNpcInstanceId)
    ) {
      this.focusedNpcInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'npc' &&
      !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }

    const pointer = this.scene.input.activePointer;
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const hoveredContainer = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectBeContainer(placed),
    );
    if (hoveredContainer) {
      if (this.focusedContainerInstanceId !== hoveredContainer.instanceId) {
        this.containerStatusText = null;
      }
      this.focusedContainerInstanceId = hoveredContainer.instanceId;
      this.focusedSwordsmanInstanceId = null;
      this.focusedPoliceInstanceId = null;
      this.focusedNpcInstanceId = null;
    } else if (this.pinnedInspector?.kind !== 'container') {
      this.focusedContainerInstanceId = null;
      const hoveredSwordsman = this.editRuntime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) => placed.id === SWORDSMAN_AI_OBJECT_ID,
      );
      if (hoveredSwordsman) {
        if (this.focusedSwordsmanInstanceId !== hoveredSwordsman.instanceId) {
          this.swordsmanStatusText = null;
        }
        this.focusedSwordsmanInstanceId = hoveredSwordsman.instanceId;
      } else if (this.pinnedInspector?.kind !== 'swordsman') {
        this.focusedSwordsmanInstanceId = null;
        const hoveredPolice = this.editRuntime.findPlacedObjectAt(
          worldPoint.x,
          worldPoint.y,
          (placed) => isPoliceEnemyObjectId(placed.id),
        );
        if (hoveredPolice) {
          if (this.focusedPoliceInstanceId !== hoveredPolice.instanceId) {
            this.policeStatusText = null;
          }
          this.focusedPoliceInstanceId = hoveredPolice.instanceId;
        } else if (this.pinnedInspector?.kind !== 'police') {
          this.focusedPoliceInstanceId = null;
          const hoveredNpc = this.editRuntime.findPlacedObjectAt(
            worldPoint.x,
            worldPoint.y,
            (placed) => isNpcObjectId(placed.id),
          );
          if (hoveredNpc) {
            if (this.focusedNpcInstanceId !== hoveredNpc.instanceId) {
              this.npcStatusText = null;
            }
            this.focusedNpcInstanceId = hoveredNpc.instanceId;
          } else if (this.pinnedInspector?.kind !== 'npc') {
            this.focusedNpcInstanceId = null;
          }
        }
      }
    }

    const focused = this.getFocusedContainer();
    if (!focused) {
      this.renderContainerContentsPanel();
      return;
    }

    this.core.drawContainerOverlay(graphics, focused);
    this.renderContainerContentsPanel();
  }

  handleObjectModePrimaryAction(pointer: Phaser.Input.Pointer): boolean {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.connectingPressurePlateInstanceId) {
      return this.handlePressurePlateConnectionClick(worldPoint.x, worldPoint.y);
    }

    const clickedPolice = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => isPoliceEnemyObjectId(placed.id),
    );
    if (clickedPolice) {
      this.focusedPoliceInstanceId = clickedPolice.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedContainerInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.focusedNpcInstanceId = null;
      this.pinInspector('police', clickedPolice.instanceId);
      this.policeStatusText = null;
      this.renderInspectorUi();
      return true;
    }

    const clickedNpc = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => isNpcObjectId(placed.id),
    );
    if (clickedNpc) {
      this.focusedNpcInstanceId = clickedNpc.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedContainerInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.focusedPoliceInstanceId = null;
      this.pinInspector('npc', clickedNpc.instanceId);
      this.npcStatusText = null;
      this.renderInspectorUi();
      return true;
    }

    const clickedSign = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectHaveSignText(placed) && !isNpcObjectId(placed.id),
    );
    if (clickedSign?.instanceId) {
      this.openSignTextEditor(clickedSign);
      return true;
    }

    const clickedPressurePlate = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectUseObjectLink(placed),
    );
    if (clickedPressurePlate) {
      this.focusedPressurePlateInstanceId = clickedPressurePlate.instanceId;
      this.focusedContainerInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.focusedPoliceInstanceId = null;
      this.focusedNpcInstanceId = null;
      this.pinInspector('pressure', clickedPressurePlate.instanceId);
      this.pressurePlateStatusText = null;
      this.renderPressurePlatePanel();
      return true;
    }

    if (this.handleContainerContentsClick(worldPoint.x, worldPoint.y)) {
      return true;
    }

    const clickedSwordsman = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => placed.id === SWORDSMAN_AI_OBJECT_ID,
    );
    if (clickedSwordsman) {
      this.focusedSwordsmanInstanceId = clickedSwordsman.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedContainerInstanceId = null;
      this.focusedPoliceInstanceId = null;
      this.focusedNpcInstanceId = null;
      this.pinInspector('swordsman', clickedSwordsman.instanceId);
      this.swordsmanStatusText = null;
      this.renderInspectorUi();
      return true;
    }

    if (this.pinnedInspector) {
      const hasSelectedObject = Boolean(editorState.selectedObjectId);
      this.clearPinnedInspector();
      return !hasSelectedObject;
    }

    return false;
  }

  handleObjectModeSecondaryAction(worldX: number, worldY: number): boolean {
    if (!this.connectingPressurePlateInstanceId) {
      return false;
    }

    if (this.editRuntime.canRemoveObjectAt(worldX, worldY)) {
      return false;
    }

    this.cancelPressurePlateConnection();
    return true;
  }

  handleObjectPlaced(placed: PlacedObject | null): void {
    if (placed?.instanceId && isPoliceEnemyObjectId(placed.id)) {
      this.focusedPoliceInstanceId = placed.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedContainerInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.focusedNpcInstanceId = null;
      this.pinInspector('police', placed.instanceId);
      this.policeStatusText = `${getObjectById(placed.id)?.name ?? 'Police enemy'} placed. Choose how it should behave.`;
      this.renderInspectorUi();
      return;
    }

    if (placed?.instanceId && isNpcObjectId(placed.id)) {
      this.focusedNpcInstanceId = placed.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedContainerInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.focusedPoliceInstanceId = null;
      this.pinInspector('npc', placed.instanceId);
      this.npcStatusText = `${getObjectById(placed.id)?.name ?? 'NPC'} placed. Choose how it should behave.`;
      this.renderInspectorUi();
      return;
    }

    if (placed?.instanceId && canPlacedObjectHaveSignText(placed)) {
      this.openSignTextEditor(placed);
      return;
    }

    if (placed && canPlacedObjectUseObjectLink(placed)) {
      this.focusedContainerInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.focusedPoliceInstanceId = null;
      this.focusedNpcInstanceId = null;
      this.focusedPressurePlateInstanceId = placed.instanceId;
      this.pinInspector('pressure', placed.instanceId);
      this.beginPressurePlateConnection(placed.instanceId, true);
      return;
    }

    if (placed && canPlacedObjectBeContainer(placed)) {
      this.focusedContainerInstanceId = placed.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.focusedPoliceInstanceId = null;
      this.focusedNpcInstanceId = null;
      this.pinInspector('container', placed.instanceId);
      this.containerStatusText = `${getContainerName(placed.id)} placed. Select a ${getContainerAcceptedContentsLabel(placed.id)} and click it to fill the container.`;
      this.renderContainerContentsPanel();
      return;
    }

    if (placed && placed.id === SWORDSMAN_AI_OBJECT_ID) {
      this.focusedSwordsmanInstanceId = placed.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedContainerInstanceId = null;
      this.focusedPoliceInstanceId = null;
      this.focusedNpcInstanceId = null;
      this.pinInspector('swordsman', placed.instanceId);
      this.swordsmanStatusText = 'Sword Hunter placed. Choose what it should try to do.';
      this.renderInspectorUi();
    }
  }

  handleObjectRemoved(removed: PlacedObject | null): void {
    if (!removed) {
      return;
    }

    if (removed.instanceId === this.connectingPressurePlateInstanceId) {
      this.connectingPressurePlateInstanceId = null;
    }
    if (removed.instanceId === this.focusedPressurePlateInstanceId) {
      this.focusedPressurePlateInstanceId = null;
    }
    if (removed.instanceId === this.focusedContainerInstanceId) {
      this.focusedContainerInstanceId = null;
    }
    if (removed.instanceId === this.focusedSwordsmanInstanceId) {
      this.focusedSwordsmanInstanceId = null;
    }
    if (removed.instanceId === this.focusedPoliceInstanceId) {
      this.focusedPoliceInstanceId = null;
    }
    if (removed.instanceId === this.focusedNpcInstanceId) {
      this.focusedNpcInstanceId = null;
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
    if (removed.id === SWORDSMAN_AI_OBJECT_ID) {
      this.swordsmanStatusText = 'Sword Hunter removed.';
    }
    if (isPoliceEnemyObjectId(removed.id)) {
      this.policeStatusText = `${getObjectById(removed.id)?.name ?? 'Police enemy'} removed.`;
    }
    if (isNpcObjectId(removed.id)) {
      this.npcStatusText = `${getObjectById(removed.id)?.name ?? 'NPC'} removed.`;
    }
    this.renderPressurePlatePanel();
    this.renderContainerContentsPanel();
    this.renderInspectorUi();
  }

  handleObjectSpritesRebuilt(): void {
    if (this.pinnedInspector && !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)) {
      this.pinnedInspector = null;
    }
    this.renderPressurePlatePanel();
    this.renderContainerContentsPanel();
    this.renderInspectorUi();
  }

  beginFocusedPressurePlateConnection(): void {
    const focused = this.getFocusedPressurePlate();
    if (!focused) {
      this.pressurePlateStatusText = 'Hover or place a linkable object first.';
      this.renderPressurePlatePanel();
      return;
    }

    this.beginPressurePlateConnection(focused.instanceId, false);
  }

  clearFocusedPressurePlateConnection(): void {
    this.core.clearLink(this.getFocusedPressurePlate());
  }

  cancelPressurePlateConnection(): void {
    if (!this.connectingPressurePlateInstanceId) {
      return;
    }

    this.connectingPressurePlateInstanceId = null;
    const focused = this.getFocusedPressurePlate();
    this.pressurePlateStatusText = `${this.linkCopy.sourceLabel(focused)} left unlinked for now.`;
    if (this.focusedPressurePlateInstanceId) {
      this.pinInspector('pressure', this.focusedPressurePlateInstanceId);
    }
    this.renderPressurePlatePanel();
  }

  clearFocusedContainerContents(): void {
    const focused = this.getFocusedContainer();
    if (!focused || !canPlacedObjectBeContainer(focused)) {
      return;
    }

    if (this.editRuntime.setContainerContents(focused.instanceId, null)) {
      this.focusedContainerInstanceId = focused.instanceId;
      this.pinInspector('container', focused.instanceId);
      this.containerStatusText = `${getContainerName(focused.id)} is now empty.`;
      this.renderContainerContentsPanel();
    }
  }

  setFocusedSwordsmanObjectiveMode(objectiveMode: SwordsmanObjectiveMode): void {
    const focused = this.getFocusedSwordsman();
    if (!focused) {
      this.swordsmanStatusText = 'Select a Sword Hunter first.';
      this.renderInspectorUi();
      return;
    }

    const normalizedMode =
      normalizeSwordsmanObjectiveMode(objectiveMode) ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE;
    if (this.editRuntime.setSwordsmanObjectiveMode(focused.instanceId, normalizedMode)) {
      this.focusedSwordsmanInstanceId = focused.instanceId;
      this.pinInspector('swordsman', focused.instanceId);
      this.swordsmanStatusText = `Sword Hunter set to ${SWORDSMAN_OBJECTIVE_MODE_LABELS[normalizedMode]}.`;
      this.renderInspectorUi();
    }
  }

  setFocusedSwordsmanDefeatMode(defeatMode: SwordsmanDefeatMode): void {
    const focused = this.getFocusedSwordsman();
    if (!focused) {
      this.swordsmanStatusText = 'Select a Sword Hunter first.';
      this.renderInspectorUi();
      return;
    }

    const normalizedMode =
      normalizeSwordsmanDefeatMode(defeatMode) ?? DEFAULT_SWORDSMAN_DEFEAT_MODE;
    if (this.editRuntime.setSwordsmanDefeatMode(focused.instanceId, normalizedMode)) {
      this.focusedSwordsmanInstanceId = focused.instanceId;
      this.pinInspector('swordsman', focused.instanceId);
      this.swordsmanStatusText = `Sword Hunter defeat behavior set to ${SWORDSMAN_DEFEAT_MODE_LABELS[normalizedMode]}.`;
      this.renderInspectorUi();
    }
  }

  setFocusedBossHitPoints(value: number | null): void {
    const focused = this.getFocusedSwordsman() ?? this.getFocusedPolice();
    if (!focused || !this.editRuntime.setBossHitPoints(focused.instanceId, value)) return;
    this.pinInspector(focused.id === SWORDSMAN_AI_OBJECT_ID ? 'swordsman' : 'police', focused.instanceId);
    this.swordsmanStatusText = null;
    this.policeStatusText = null;
    this.renderInspectorUi();
  }

  setFocusedPoliceBehaviorMode(mode: PoliceBehaviorMode): void {
    const focused = this.getFocusedPolice();
    if (!focused) {
      this.policeStatusText = 'Select a police enemy first.';
      this.renderInspectorUi();
      return;
    }

    const normalizedMode = normalizePoliceBehaviorMode(mode) ?? DEFAULT_POLICE_BEHAVIOR_MODE;
    if (this.editRuntime.setPoliceBehaviorMode(focused.instanceId, normalizedMode)) {
      this.focusedPoliceInstanceId = focused.instanceId;
      this.pinInspector('police', focused.instanceId);
      const objectName = getObjectById(focused.id)?.name ?? 'Police enemy';
      this.policeStatusText = `${objectName} set to ${POLICE_BEHAVIOR_MODE_LABELS[normalizedMode]}.`;
      this.renderInspectorUi();
    }
  }

  setFocusedPolicePatrolShoots(patrolShoots: boolean): void {
    const focused = this.getFocusedPolice();
    if (!focused) {
      this.policeStatusText = 'Select a police enemy first.';
      this.renderInspectorUi();
      return;
    }

    if (this.editRuntime.setPolicePatrolShoots(focused.instanceId, patrolShoots)) {
      this.focusedPoliceInstanceId = focused.instanceId;
      this.pinInspector('police', focused.instanceId);
      const objectName = getObjectById(focused.id)?.name ?? 'Police enemy';
      this.policeStatusText = patrolShoots
        ? `${objectName} will shoot when the player enters its patrol sightline.`
        : `${objectName} will patrol without shooting.`;
      this.renderInspectorUi();
    }
  }

  setFocusedNpcMode(mode: NpcMode): void {
    const focused = this.getFocusedNpc();
    if (!focused) {
      return;
    }
    if (this.editRuntime.setNpcMode(focused.instanceId, mode)) {
      this.focusedNpcInstanceId = focused.instanceId;
      this.pinInspector('npc', focused.instanceId);
      this.npcStatusText = `${getObjectById(focused.id)?.name ?? 'NPC'} mode set to ${NPC_MODE_LABELS[mode]}.`;
      this.renderInspectorUi();
    }
  }

  setFocusedNpcPushable(pushable: boolean): void {
    const focused = this.getFocusedNpc();
    if (focused && this.editRuntime.setNpcPushable(focused.instanceId, pushable)) {
      this.focusedNpcInstanceId = focused.instanceId;
      this.pinInspector('npc', focused.instanceId);
      this.renderInspectorUi();
    }
  }

  setFocusedNpcCanJumpFall(canJumpFall: boolean): void {
    const focused = this.getFocusedNpc();
    if (focused && this.editRuntime.setNpcCanJumpFall(focused.instanceId, canJumpFall)) {
      this.focusedNpcInstanceId = focused.instanceId;
      this.pinInspector('npc', focused.instanceId);
      this.renderInspectorUi();
    }
  }

  setFocusedNpcPlayerCollision(playerCollision: boolean): void {
    const focused = this.getFocusedNpc();
    if (focused && this.editRuntime.setNpcPlayerCollision(focused.instanceId, playerCollision)) {
      this.focusedNpcInstanceId = focused.instanceId;
      this.pinInspector('npc', focused.instanceId);
      this.renderInspectorUi();
    }
  }

  setFocusedNpcFriendlyFire(friendlyFire: boolean): void {
    const focused = this.getFocusedNpc();
    if (focused && this.editRuntime.setNpcFriendlyFire(focused.instanceId, friendlyFire)) {
      this.focusedNpcInstanceId = focused.instanceId;
      this.pinInspector('npc', focused.instanceId);
      this.renderInspectorUi();
    }
  }

  setFocusedNpcName(name: string): void {
    const focused = this.getFocusedNpc();
    if (focused && this.editRuntime.setNpcName(focused.instanceId, name)) {
      this.focusedNpcInstanceId = focused.instanceId;
      this.pinInspector('npc', focused.instanceId);
      this.renderInspectorUi();
    }
  }

  setFocusedNpcDialogue(text: string): void {
    const focused = this.getFocusedNpc();
    if (focused && this.editRuntime.setNpcDialogue(focused.instanceId, text)) {
      this.focusedNpcInstanceId = focused.instanceId;
      this.pinInspector('npc', focused.instanceId);
      this.renderInspectorUi();
    }
  }

  setFocusedNpcDefeatMode(defeatMode: SwordsmanDefeatMode): void {
    const focused = this.getFocusedNpc();
    if (focused && this.editRuntime.setNpcDefeatMode(focused.instanceId, defeatMode)) {
      this.focusedNpcInstanceId = focused.instanceId;
      this.pinInspector('npc', focused.instanceId);
      this.renderInspectorUi();
    }
  }

  clearPinnedSelection(): void {
    this.clearPinnedInspector();
  }

  private renderPressurePlatePanel(): void {
    this.renderInspectorUi();
  }

  private renderContainerContentsPanel(): void {
    this.renderInspectorUi();
  }

  private renderInspectorUi(): void {
    const render = (state: EditorInspectorState) => this.renderInspector({
      ...state,
      pinned: this.pinnedInspector !== null,
      connecting: this.connectingPressurePlateInstanceId !== null,
      selectionId: this.connectingPressurePlateInstanceId ?? this.pinnedInspector?.instanceId ?? null,
    });
    const hiddenState = createEmptyEditorInspectorState();
    if (editorState.isPlaying) {
      render(hiddenState);
      return;
    }

    const connectMode = this.connectingPressurePlateInstanceId !== null;
    const source =
      this.pinnedInspector && this.pinnedInspector.kind !== 'pressure' && !connectMode
        ? null
        : this.getFocusedPressurePlate();
    if (source && (editorState.paletteMode === 'objects' || connectMode)) {
      const targets = this.getObjectLinkTargets(source);
      const eligibleTargetCount = this.editRuntime.getObjectLinkEligibleTargets(source.instanceId).length
        + (canPlacedObjectTriggerOtherObjects(source) && getRoomVideo(this.editRuntime)?.trigger ? 1 : 0);
      const videoLinked = canPlacedObjectTriggerOtherObjects(source)
        && isRoomVideoLinkTarget(source.triggerTargetInstanceId);
      const pressureStatusText =
          this.pressurePlateStatusText ??
          (connectMode
            ? this.linkCopy.connectStatus(source, eligibleTargetCount)
            : targets.length > 0
              ? this.linkCopy.linkedStatus(source, targets)
              : videoLinked
                ? `${this.linkCopy.sourceLabel(source)} linked to the video.`
                : `${this.linkCopy.sourceLabel(source)} is not linked yet.`);
      render(buildPressurePlateInspectorState({
        statusText: pressureStatusText,
        connectMode,
        targetSummary: targets.length > 0 || videoLinked ? pressureStatusText : null,
        eligibleTargetCount,
        connectTitle: this.linkCopy.noTargetsTitle(source),
        allowReconnectWithTarget: true,
        coopAvailable: canConfigureCoopPlate(source),
        coopPlate: isCoopPressurePlate(source),
      }));
      return;
    }

    const focusedContainer =
      this.pinnedInspector && this.pinnedInspector.kind !== 'container' && !connectMode
        ? null
        : this.getFocusedContainer();
    if (focusedContainer && editorState.paletteMode === 'objects' && !this.connectingPressurePlateInstanceId) {
      const selectedObject = editorState.selectedObjectId
        ? getEditorObjectConfigById(editorState.selectedObjectId) ?? null
        : null;
      const selectedLooksLikeContents =
        selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
      const canStoreSelected = canStoreEditorContainerContents(focusedContainer.id, selectedObject);
      const currentContentsLabel = this.editRuntime.getContainerContentsLabel(focusedContainer);
      render(buildContainerInspectorState({
        containerObjectId: focusedContainer.id,
        statusText: this.containerStatusText,
        selectedObject,
        selectedLooksLikeContents,
        canStoreSelected,
        currentContentsLabel,
        hasContents: Boolean(focusedContainer.containedObjectId),
      }));
      return;
    }

    const actor = this.getFocusedSwordsman() ?? this.getFocusedPolice() ?? this.getFocusedNpc();
    if (actor && editorState.paletteMode === 'objects' && !connectMode) {
      const status = actor.id === SWORDSMAN_AI_OBJECT_ID ? this.swordsmanStatusText
        : isPoliceEnemyObjectId(actor.id) ? this.policeStatusText : this.npcStatusText;
      const state = buildActorInspectorState(actor, status);
      if (state) { render(state); return; }
    }

    render(hiddenState);
  }

  private beginPressurePlateConnection(triggerInstanceId: string, autoPlaced: boolean): void {
    const trigger = this.editRuntime.getPlacedObjectByInstanceId(triggerInstanceId);
    if (!trigger || !canPlacedObjectUseObjectLink(trigger)) {
      return;
    }

    this.focusedPressurePlateInstanceId = trigger.instanceId;
    this.connectingPressurePlateInstanceId = trigger.instanceId;
    this.pinInspector('pressure', trigger.instanceId);
    const eligibleTargets = this.editRuntime.getObjectLinkEligibleTargets(trigger.instanceId);
    this.pressurePlateStatusText =
      eligibleTargets.length > 0
        ? this.linkCopy.beginStatus(trigger, autoPlaced)
        : this.linkCopy.noTargetsStatus(trigger);
    this.renderPressurePlatePanel();
  }

  private handlePressurePlateConnectionClick(worldX: number, worldY: number): boolean {
    return this.core.clickConnection({ x: worldX, y: worldY });
  }

  private handleContainerContentsClick(worldX: number, worldY: number): boolean {
    return this.core.clickContainer({ x: worldX, y: worldY });
  }

  private pinInspector(kind: 'pressure' | 'container' | 'swordsman' | 'police' | 'npc', instanceId: string): void {
    this.pinnedInspector = { kind, instanceId };
  }

  private clearPinnedInspector(): void {
    this.connectingPressurePlateInstanceId = null;
    this.pinnedInspector = null;
    this.focusedPressurePlateInstanceId = null;
    this.focusedContainerInstanceId = null;
    this.focusedSwordsmanInstanceId = null;
    this.focusedPoliceInstanceId = null;
    this.focusedNpcInstanceId = null;
    this.pressurePlateStatusText = null;
    this.containerStatusText = null;
    this.swordsmanStatusText = null;
    this.policeStatusText = null;
    this.npcStatusText = null;
    this.renderInspectorUi();
  }

  private getFocusedPressurePlate(): PlacedObject | null {
    const pinnedPressureId = this.pinnedInspector?.kind === 'pressure' ? this.pinnedInspector.instanceId : null;
    const activeId =
      this.connectingPressurePlateInstanceId ?? pinnedPressureId ?? this.focusedPressurePlateInstanceId;
    const focused = this.editRuntime.getPlacedObjectByInstanceId(activeId);
    if (focused && canPlacedObjectUseObjectLink(focused)) {
      return focused;
    }

    return null;
  }

  private getFocusedContainer(): PlacedObject | null {
    const pinnedContainerId = this.pinnedInspector?.kind === 'container' ? this.pinnedInspector.instanceId : null;
    const focused = this.editRuntime.getPlacedObjectByInstanceId(
      pinnedContainerId ?? this.focusedContainerInstanceId,
    );
    if (focused && canPlacedObjectBeContainer(focused)) {
      return focused;
    }

    return null;
  }

  private getFocusedSwordsman(): PlacedObject | null {
    const pinnedSwordsmanId = this.pinnedInspector?.kind === 'swordsman'
      ? this.pinnedInspector.instanceId
      : null;
    const focused = this.editRuntime.getPlacedObjectByInstanceId(
      pinnedSwordsmanId ?? this.focusedSwordsmanInstanceId,
    );
    if (focused?.id === SWORDSMAN_AI_OBJECT_ID) {
      return focused;
    }

    return null;
  }

  private getFocusedNpc(): PlacedObject | null {
    const pinnedNpcId = this.pinnedInspector?.kind === 'npc'
      ? this.pinnedInspector.instanceId
      : null;
    const focused = this.editRuntime.getPlacedObjectByInstanceId(
      pinnedNpcId ?? this.focusedNpcInstanceId,
    );
    return focused && isNpcObjectId(focused.id) ? focused : null;
  }

  private getFocusedPolice(): PlacedObject | null {
    const pinnedPoliceId = this.pinnedInspector?.kind === 'police'
      ? this.pinnedInspector.instanceId
      : null;
    const focused = this.editRuntime.getPlacedObjectByInstanceId(
      pinnedPoliceId ?? this.focusedPoliceInstanceId,
    );
    return focused && isPoliceEnemyObjectId(focused.id) ? focused : null;
  }

  private getConnectingPressurePlate(): PlacedObject | null {
    const focused = this.editRuntime.getPlacedObjectByInstanceId(this.connectingPressurePlateInstanceId);
    if (focused && canPlacedObjectUseObjectLink(focused)) {
      return focused;
    }

    return null;
  }

  private getObjectLinkTargets(source: PlacedObject): PlacedObject[] {
    if (canPlacedObjectUseObjectPath(source)) {
      return this.editRuntime.getObjectPathTargets(source.instanceId);
    }

    if (isRoomVideoLinkTarget(source.triggerTargetInstanceId)) return [];
    const target = this.editRuntime.getPlacedObjectByInstanceId(source.triggerTargetInstanceId ?? null);
    return target ? [target] : [];
  }

  private openSignTextEditor(placed: PlacedObject): void {
    if (!placed.instanceId) {
      return;
    }

    requestSignTextEdit({
      instanceId: placed.instanceId,
      objectId: placed.id,
      objectLabel: getObjectById(placed.id)?.name ?? 'Sign',
      currentText: getPlacedObjectSignText(placed) ?? '',
      contextHint: null,
    });
  }
}
