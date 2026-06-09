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
  type PlacedObject,
} from '../../config';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { SWORDSMAN_AI_OBJECT_ID } from '../../enemies/swordsmanAi';
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

type PinnedInspector = { kind: 'pressure' | 'container' | 'swordsman'; instanceId: string } | null;

export class EditorInspectorController {
  private focusedPressurePlateInstanceId: string | null = null;
  private connectingPressurePlateInstanceId: string | null = null;
  private pressurePlateStatusText: string | null = null;
  private focusedContainerInstanceId: string | null = null;
  private containerStatusText: string | null = null;
  private focusedSwordsmanInstanceId: string | null = null;
  private swordsmanStatusText: string | null = null;
  private pinnedInspector: PinnedInspector = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly editRuntime: EditorEditRuntime,
    private readonly renderInspector: (state: EditorInspectorState) => void,
  ) {}

  isConnectingPressurePlate(): boolean {
    return this.connectingPressurePlateInstanceId !== null;
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
    this.renderInspector(this.createEmptyInspectorState());
  }

  private clearTransientObjectInspectorState(): void {
    this.focusedPressurePlateInstanceId = null;
    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = null;
    this.focusedContainerInstanceId = null;
    this.containerStatusText = null;
    this.focusedSwordsmanInstanceId = null;
    this.swordsmanStatusText = null;
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

    const source = this.getFocusedPressurePlate();
    if (!source) {
      this.renderPressurePlatePanel();
      return;
    }

    const currentTargets = this.getObjectLinkTargets(source);
    this.drawObjectLinkPath(graphics, source, currentTargets, 0x6dd5ff, 0.9);

    const sourceBounds = this.editRuntime.getPlacedObjectBounds(source);
    graphics.lineStyle(2, 0xc3f4ff, 0.88);
    graphics.strokeRoundedRect(
      sourceBounds.x,
      sourceBounds.y,
      sourceBounds.width,
      sourceBounds.height,
      6,
    );

    if (this.connectingPressurePlateInstanceId === source.instanceId) {
      const hoveredTarget = this.editRuntime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) => this.canUseObjectLinkTarget(source, placed),
      );
      const eligibleTargets = this.editRuntime.getObjectLinkEligibleTargets(source.instanceId);
      for (const target of eligibleTargets) {
        const bounds = this.editRuntime.getPlacedObjectBounds(target);
        graphics.lineStyle(
          2,
          hoveredTarget?.instanceId === target.instanceId ? 0x9dff8a : 0x7ad3ff,
          hoveredTarget?.instanceId === target.instanceId ? 0.95 : 0.55,
        );
        graphics.strokeRoundedRect(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          6,
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
        graphics.moveTo(previewSource.x, previewSource.y - 4);
        graphics.lineTo(worldPoint.x, worldPoint.y);
        graphics.strokePath();
      }
    }

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
      }
    }

    const focused = this.getFocusedContainer();
    if (!focused) {
      this.renderContainerContentsPanel();
      return;
    }

    const bounds = this.editRuntime.getPlacedObjectBounds(focused);
    const selectedObject = editorState.selectedObjectId
      ? getEditorObjectConfigById(editorState.selectedObjectId)
      : null;
    const canStoreSelected = canObjectBeStoredInContainer(focused.id, selectedObject);
    const selectedObjectLooksLikeContents =
      selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
    const strokeColor = canStoreSelected ? 0x9dff8a : selectedObjectLooksLikeContents ? 0xffc76b : 0xffe0a6;
    const strokeAlpha = canStoreSelected ? 0.92 : 0.74;
    graphics.lineStyle(2, strokeColor, strokeAlpha);
    graphics.strokeRoundedRect(
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      6,
    );
    graphics.fillStyle(strokeColor, 0.86);
    graphics.fillCircle(focused.x, focused.y - 6, 3);

    this.renderContainerContentsPanel();
  }

  handleObjectModePrimaryAction(pointer: Phaser.Input.Pointer): boolean {
    const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.connectingPressurePlateInstanceId) {
      return this.handlePressurePlateConnectionClick(worldPoint.x, worldPoint.y);
    }

    const clickedSign = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectHaveSignText(placed),
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
    if (placed?.instanceId && canPlacedObjectHaveSignText(placed)) {
      this.openSignTextEditor(placed);
      return;
    }

    if (placed && canPlacedObjectUseObjectLink(placed)) {
      this.focusedContainerInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.focusedPressurePlateInstanceId = placed.instanceId;
      this.pinInspector('pressure', placed.instanceId);
      this.beginPressurePlateConnection(placed.instanceId, true);
      return;
    }

    if (placed && canPlacedObjectBeContainer(placed)) {
      this.focusedContainerInstanceId = placed.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedSwordsmanInstanceId = null;
      this.pinInspector('container', placed.instanceId);
      this.containerStatusText = `${this.getContainerName(placed.id)} placed. Select a ${this.getContainerAcceptedContentsLabel(placed.id)} and click it to fill the container.`;
      this.renderContainerContentsPanel();
      return;
    }

    if (placed && placed.id === SWORDSMAN_AI_OBJECT_ID) {
      this.focusedSwordsmanInstanceId = placed.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.focusedContainerInstanceId = null;
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
    if (this.pinnedInspector?.instanceId === removed.instanceId) {
      this.pinnedInspector = null;
    }
    if (canPlacedObjectBePressurePlateTarget(removed) || isMovingPlatformEndpointObjectId(removed.id)) {
      this.pressurePlateStatusText = `${this.getObjectLinkTargetLabel(removed.id)} removed. Linked objects were cleared.`;
    }
    if (canPlacedObjectBeContainer(removed)) {
      this.containerStatusText = `${this.getContainerName(removed.id)} removed.`;
    }
    if (removed.id === SWORDSMAN_AI_OBJECT_ID) {
      this.swordsmanStatusText = 'Sword Hunter removed.';
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
    const focused = this.getFocusedPressurePlate();
    if (!focused || !canPlacedObjectUseObjectLink(focused)) {
      return;
    }

    if (this.editRuntime.setObjectLinkTarget(focused.instanceId, null)) {
      this.pressurePlateStatusText = `${this.getObjectLinkSourceLabel(focused)} link cleared.`;
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = focused.instanceId;
      this.pinInspector('pressure', focused.instanceId);
      this.renderPressurePlatePanel();
    }
  }

  cancelPressurePlateConnection(): void {
    if (!this.connectingPressurePlateInstanceId) {
      return;
    }

    this.connectingPressurePlateInstanceId = null;
    const focused = this.getFocusedPressurePlate();
    this.pressurePlateStatusText = `${this.getObjectLinkSourceLabel(focused)} left unlinked for now.`;
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
      this.containerStatusText = `${this.getContainerName(focused.id)} is now empty.`;
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

  clearPinnedSelection(): void {
    this.clearPinnedInspector();
  }

  private drawPressurePlateLink(
    graphics: Phaser.GameObjects.Graphics,
    source: PlacedObject,
    target: PlacedObject,
    color: number,
    alpha: number,
  ): void {
    graphics.lineStyle(2, color, alpha);
    graphics.beginPath();
    graphics.moveTo(source.x, source.y - 4);
    graphics.lineTo(target.x, target.y - 6);
    graphics.strokePath();
    graphics.fillStyle(color, alpha * 0.9);
    graphics.fillCircle(source.x, source.y - 4, 3);
    graphics.fillCircle(target.x, target.y - 6, 3);
  }

  private drawObjectLinkPath(
    graphics: Phaser.GameObjects.Graphics,
    source: PlacedObject,
    targets: PlacedObject[],
    color: number,
    alpha: number,
  ): void {
    let previous = source;
    for (const target of targets) {
      this.drawPressurePlateLink(graphics, previous, target, color, alpha);
      previous = target;
    }
  }

  private renderPressurePlatePanel(): void {
    this.renderInspectorUi();
  }

  private renderContainerContentsPanel(): void {
    this.renderInspectorUi();
  }

  private createEmptyInspectorState(): EditorInspectorState {
    return {
      visible: false,
      pressureVisible: false,
      pressureStatusText: '',
      pressureConnectHidden: true,
      pressureConnectDisabled: true,
      pressureConnectTitle: '',
      pressureClearHidden: true,
      pressureClearDisabled: true,
      pressureDoneLaterHidden: true,
      containerVisible: false,
      containerStatusText: '',
      containerClearDisabled: true,
      containerClearTitle: '',
      swordsmanVisible: false,
      swordsmanStatusText: '',
      swordsmanObjectiveModeValue: DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
      swordsmanObjectiveModeDisabled: true,
      swordsmanDefeatModeValue: DEFAULT_SWORDSMAN_DEFEAT_MODE,
      swordsmanDefeatModeDisabled: true,
    };
  }

  private renderInspectorUi(): void {
    const hiddenState = this.createEmptyInspectorState();
    if (editorState.isPlaying) {
      this.renderInspector(hiddenState);
      return;
    }

    const connectMode = this.connectingPressurePlateInstanceId !== null;
    const source =
      this.pinnedInspector && this.pinnedInspector.kind !== 'pressure' && !connectMode
        ? null
        : this.getFocusedPressurePlate();
    if (source && (editorState.paletteMode === 'objects' || connectMode)) {
      const targets = this.getObjectLinkTargets(source);
      const eligibleTargetCount = this.editRuntime.getObjectLinkEligibleTargets(source.instanceId).length;
      this.renderInspector({
        ...hiddenState,
        visible: true,
        pressureVisible: true,
        pressureStatusText:
          this.pressurePlateStatusText ??
          (connectMode
            ? this.getObjectLinkConnectStatus(source, eligibleTargetCount)
            : targets.length > 0
              ? this.getObjectLinkLinkedStatus(source, targets)
              : `${this.getObjectLinkSourceLabel(source)} is not linked yet.`),
        pressureConnectHidden: connectMode,
        pressureConnectDisabled: connectMode || eligibleTargetCount === 0,
        pressureConnectTitle: eligibleTargetCount === 0 ? this.getObjectLinkNoTargetsTitle(source) : '',
        pressureClearHidden: connectMode,
        pressureClearDisabled: targets.length === 0,
        pressureDoneLaterHidden: !connectMode,
      });
      return;
    }

    const focusedContainer =
      this.pinnedInspector && this.pinnedInspector.kind !== 'container' && !connectMode
        ? null
        : this.getFocusedContainer();
    if (focusedContainer && editorState.paletteMode === 'objects' && !this.connectingPressurePlateInstanceId) {
      const selectedObject = editorState.selectedObjectId
        ? getEditorObjectConfigById(editorState.selectedObjectId)
        : null;
      const selectedLooksLikeContents =
        selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
      const canStoreSelected = canObjectBeStoredInContainer(focusedContainer.id, selectedObject);
      const currentContentsLabel = this.editRuntime.getContainerContentsLabel(focusedContainer);
      this.renderInspector({
        ...hiddenState,
        visible: true,
        containerVisible: true,
        containerStatusText:
          this.containerStatusText ??
          (canStoreSelected && selectedObject
            ? `Click this ${this.getContainerLabel(focusedContainer.id)} to stash ${selectedObject.name} inside.`
            : selectedLooksLikeContents && selectedObject
              ? `${this.getContainerName(focusedContainer.id)} can only hold ${this.getContainerAcceptedContentsLabel(focusedContainer.id)}.`
              : currentContentsLabel
                ? `${this.getContainerName(focusedContainer.id)} currently holds ${currentContentsLabel}. Select a ${this.getContainerAcceptedContentsLabel(focusedContainer.id)} and click it to change the contents.`
                : `${this.getContainerName(focusedContainer.id)} is empty. Select a ${this.getContainerAcceptedContentsLabel(focusedContainer.id)} from the object list, then click it to fill the container.`),
        containerClearDisabled: !focusedContainer.containedObjectId,
        containerClearTitle: focusedContainer.containedObjectId ? '' : 'This container is empty.',
      });
      return;
    }

    const focusedSwordsman = this.getFocusedSwordsman();
    if (focusedSwordsman && editorState.paletteMode === 'objects' && !this.connectingPressurePlateInstanceId) {
      const objectiveMode =
        normalizeSwordsmanObjectiveMode(focusedSwordsman.swordsmanObjectiveMode)
        ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE;
      const defeatMode =
        normalizeSwordsmanDefeatMode(focusedSwordsman.swordsmanDefeatMode)
        ?? DEFAULT_SWORDSMAN_DEFEAT_MODE;
      this.renderInspector({
        ...hiddenState,
        visible: true,
        swordsmanVisible: true,
        swordsmanStatusText:
          this.swordsmanStatusText
          ?? `This Sword Hunter is set to ${SWORDSMAN_OBJECTIVE_MODE_LABELS[objectiveMode]} / ${SWORDSMAN_DEFEAT_MODE_LABELS[defeatMode]}.`,
        swordsmanObjectiveModeValue: objectiveMode,
        swordsmanObjectiveModeDisabled: false,
        swordsmanDefeatModeValue: defeatMode,
        swordsmanDefeatModeDisabled: false,
      });
      return;
    }

    this.renderInspector(hiddenState);
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
        ? this.getObjectLinkBeginStatus(trigger, autoPlaced)
        : this.getObjectLinkNoTargetsStatus(trigger);
    this.renderPressurePlatePanel();
  }

  private handlePressurePlateConnectionClick(worldX: number, worldY: number): boolean {
    const source = this.getConnectingPressurePlate();
    if (!source) {
      this.connectingPressurePlateInstanceId = null;
      return false;
    }

    const target = this.editRuntime.findPlacedObjectAt(
      worldX,
      worldY,
      (placed) => this.canUseObjectLinkTarget(source, placed),
    );
    if (!target) {
      this.pressurePlateStatusText = this.getObjectLinkPickTargetStatus(source);
      this.renderPressurePlatePanel();
      return true;
    }

    if (canPlacedObjectUseObjectPath(source)) {
      const toggleResult = this.editRuntime.toggleObjectPathTarget(source.instanceId, target.instanceId);
      if (toggleResult !== 'unchanged') {
        const targetCount = this.editRuntime.getObjectPathTargetIds(source.instanceId).length;
        this.connectingPressurePlateInstanceId = source.instanceId;
        this.focusedPressurePlateInstanceId = source.instanceId;
        this.pinInspector('pressure', source.instanceId);
        this.pressurePlateStatusText =
          toggleResult === 'added'
            ? `Added ${this.getObjectLinkTargetLabel(target.id)} stop ${targetCount}. Click another anchor, or use Done Later.`
            : `Removed ${this.getObjectLinkTargetLabel(target.id)} from the path. Click another anchor, or use Done Later.`;
        this.renderPressurePlatePanel();
      }
      return true;
    }

    if (this.editRuntime.setObjectLinkTarget(source.instanceId, target.instanceId)) {
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = source.instanceId;
      this.pinInspector('pressure', source.instanceId);
      this.pressurePlateStatusText =
        `${this.getObjectLinkSourceLabel(source)} linked to ${this.getObjectLinkTargetLabel(target.id)}.`;
      this.renderPressurePlatePanel();
    }
    return true;
  }

  private handleContainerContentsClick(worldX: number, worldY: number): boolean {
    const focused = this.editRuntime.findPlacedObjectAt(
      worldX,
      worldY,
      (placed) => canPlacedObjectBeContainer(placed),
    );
    if (!focused || !focused.instanceId) {
      return false;
    }

    this.focusedContainerInstanceId = focused.instanceId;
    this.focusedPressurePlateInstanceId = null;
    this.focusedSwordsmanInstanceId = null;
    this.pinInspector('container', focused.instanceId);
    const selectedObject = editorState.selectedObjectId
      ? getEditorObjectConfigById(editorState.selectedObjectId)
      : null;
    if (!selectedObject) {
      this.renderContainerContentsPanel();
      return true;
    }

    const selectedLooksLikeContents =
      selectedObject.category === 'enemy' || selectedObject.category === 'collectible';
    if (!selectedLooksLikeContents) {
      this.renderContainerContentsPanel();
      return true;
    }

    if (!canObjectBeStoredInContainer(focused.id, selectedObject)) {
      this.containerStatusText = `${this.getContainerName(focused.id)} can only hold ${this.getContainerAcceptedContentsLabel(focused.id)}.`;
      this.renderContainerContentsPanel();
      return true;
    }

    if (this.editRuntime.setContainerContents(focused.instanceId, selectedObject.id)) {
      this.containerStatusText = `${this.getContainerName(focused.id)} now holds ${selectedObject.name}.`;
      this.renderContainerContentsPanel();
      return true;
    }

    return true;
  }

  private pinInspector(kind: 'pressure' | 'container' | 'swordsman', instanceId: string): void {
    this.pinnedInspector = { kind, instanceId };
  }

  private clearPinnedInspector(): void {
    this.pinnedInspector = null;
    this.focusedPressurePlateInstanceId = null;
    this.focusedContainerInstanceId = null;
    this.focusedSwordsmanInstanceId = null;
    this.pressurePlateStatusText = null;
    this.containerStatusText = null;
    this.swordsmanStatusText = null;
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

  private getConnectingPressurePlate(): PlacedObject | null {
    const focused = this.editRuntime.getPlacedObjectByInstanceId(this.connectingPressurePlateInstanceId);
    if (focused && canPlacedObjectUseObjectLink(focused)) {
      return focused;
    }

    return null;
  }

  private canUseObjectLinkTarget(source: PlacedObject, target: PlacedObject): boolean {
    return target.instanceId !== source.instanceId && canPlacedObjectBeLinkedObjectTarget(source, target);
  }

  private getObjectLinkTargets(source: PlacedObject): PlacedObject[] {
    if (canPlacedObjectUseObjectPath(source)) {
      return this.editRuntime.getObjectPathTargets(source.instanceId);
    }

    const target = this.editRuntime.getPlacedObjectByInstanceId(source.triggerTargetInstanceId ?? null);
    return target ? [target] : [];
  }

  private getObjectLinkPreviewSource(
    source: PlacedObject,
    currentTargets: PlacedObject[],
    hoveredTarget: PlacedObject | null,
  ): PlacedObject {
    if (!canPlacedObjectUseObjectPath(source)) {
      return source;
    }

    const pathTargets = hoveredTarget
      ? currentTargets.filter((target) => target.instanceId !== hoveredTarget.instanceId)
      : currentTargets;
    return pathTargets[pathTargets.length - 1] ?? source;
  }

  private getObjectLinkLinkedStatus(source: PlacedObject, targets: PlacedObject[]): string {
    if (canPlacedObjectUseObjectPath(source)) {
      const stopLabel = targets.length === 1 ? 'stop' : 'stops';
      return `Moving platform path has ${targets.length} ${stopLabel}.`;
    }

    return `${this.getObjectLinkSourceLabel(source)} linked to ${this.getObjectLinkTargetLabel(targets[0].id)}.`;
  }

  private getObjectLinkSourceLabel(source: PlacedObject | null): string {
    if (source && isMovingPlatformObjectId(source.id)) {
      return 'Moving platform';
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

    return autoPlaced
      ? 'Pressure plate placed. Click a door, barricade, cage, or chest to link it.'
      : 'Click a door, barricade, cage, or chest to link this pressure plate.';
  }

  private getObjectLinkPickTargetStatus(source: PlacedObject): string {
    return isMovingPlatformObjectId(source.id)
      ? 'Pick Moving Platform Anchors in this room.'
      : 'Pick a door, cage, or chest in this room.';
  }

  private getObjectLinkNoTargetsStatus(source: PlacedObject): string {
    return isMovingPlatformObjectId(source.id)
      ? 'No Moving Platform Anchor is in this room yet. You can link this moving platform later.'
      : 'No door, barricade, cage, or chest is in this room yet. You can link this pressure plate later.';
  }

  private getObjectLinkNoTargetsTitle(source: PlacedObject): string {
    return isMovingPlatformObjectId(source.id)
      ? 'Add a Moving Platform Anchor first.'
      : 'Add a door, cage, or chest first.';
  }

  private getObjectLinkTargetLabel(objectId: string): string {
    if (isMovingPlatformEndpointObjectId(objectId)) {
      return 'Moving Platform Anchor';
    }

    switch (objectId) {
      case 'door_locked':
        return 'door';
      case 'door_metal':
        return 'metal door';
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
      case 'door_locked_narrow':
        return 'narrow door';
      case 'door_metal_narrow':
        return 'narrow metal door';
      case 'wooden_bridge':
        return 'wooden bridge';
      default:
        return getObjectById(objectId)?.name ?? 'object';
    }
  }

  private getContainerLabel(objectId: string): string {
    return objectId === 'cage' ? 'cage' : 'treasure chest';
  }

  private getContainerName(objectId: string): string {
    return objectId === 'cage' ? 'This cage' : 'This treasure chest';
  }

  private getContainerAcceptedContentsLabel(objectId: string): string {
    return objectId === 'cage' ? 'enemies or crates' : 'collectibles';
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
