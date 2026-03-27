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
import { type EditorEditRuntime } from './editRuntime';
import type { EditorInspectorState } from './uiBridge';

type PinnedInspector = { kind: 'pressure' | 'container'; instanceId: string } | null;

export class EditorInspectorController {
  private focusedPressurePlateInstanceId: string | null = null;
  private connectingPressurePlateInstanceId: string | null = null;
  private pressurePlateStatusText: string | null = null;
  private focusedContainerInstanceId: string | null = null;
  private containerStatusText: string | null = null;
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
    this.focusedPressurePlateInstanceId = null;
    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = null;
    this.focusedContainerInstanceId = null;
    this.containerStatusText = null;
    this.pinnedInspector = null;
    this.renderInspectorUi();
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
        (placed) => canPlacedObjectTriggerOtherObjects(placed),
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

    const currentTarget = this.editRuntime.getPlacedObjectByInstanceId(source.triggerTargetInstanceId ?? null);
    if (currentTarget) {
      this.drawPressurePlateLink(graphics, source, currentTarget, 0x6dd5ff, 0.9);
    }

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
        (placed) => canPlacedObjectBePressurePlateTarget(placed) && placed.instanceId !== source.instanceId,
      );
      const eligibleTargets = this.editRuntime.getPressurePlateEligibleTargets(source.instanceId);
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
        this.drawPressurePlateLink(graphics, source, hoveredTarget, 0x9dff8a, 0.95);
      } else {
        graphics.lineStyle(2, 0xffd36b, 0.5);
        graphics.beginPath();
        graphics.moveTo(source.x, source.y - 4);
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
    } else if (this.pinnedInspector?.kind !== 'container') {
      this.focusedContainerInstanceId = null;
    }

    const focused = this.getFocusedContainer();
    if (!focused) {
      this.renderContainerContentsPanel();
      return;
    }

    const bounds = this.editRuntime.getPlacedObjectBounds(focused);
    const selectedObject = editorState.selectedObjectId ? getObjectById(editorState.selectedObjectId) : null;
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

    const clickedPressurePlate = this.editRuntime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectTriggerOtherObjects(placed),
    );
    if (clickedPressurePlate) {
      this.focusedPressurePlateInstanceId = clickedPressurePlate.instanceId;
      this.focusedContainerInstanceId = null;
      this.pinInspector('pressure', clickedPressurePlate.instanceId);
      this.pressurePlateStatusText = null;
      this.renderPressurePlatePanel();
      return true;
    }

    if (this.handleContainerContentsClick(worldPoint.x, worldPoint.y)) {
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
    if (placed && canPlacedObjectTriggerOtherObjects(placed)) {
      this.focusedContainerInstanceId = null;
      this.focusedPressurePlateInstanceId = placed.instanceId;
      this.pinInspector('pressure', placed.instanceId);
      this.beginPressurePlateConnection(placed.instanceId, true);
      return;
    }

    if (placed && canPlacedObjectBeContainer(placed)) {
      this.focusedContainerInstanceId = placed.instanceId;
      this.focusedPressurePlateInstanceId = null;
      this.pinInspector('container', placed.instanceId);
      this.containerStatusText = `${this.getContainerName(placed.id)} placed. Select a ${this.getContainerAcceptedContentsLabel(placed.id)} and click it to fill the container.`;
      this.renderContainerContentsPanel();
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
    if (this.pinnedInspector?.instanceId === removed.instanceId) {
      this.pinnedInspector = null;
    }
    if (canPlacedObjectBePressurePlateTarget(removed)) {
      this.pressurePlateStatusText = `${this.getPressurePlateTargetLabel(removed.id)} removed. Linked plates were cleared.`;
    }
    if (canPlacedObjectBeContainer(removed)) {
      this.containerStatusText = `${this.getContainerName(removed.id)} removed.`;
    }
    this.renderPressurePlatePanel();
    this.renderContainerContentsPanel();
  }

  handleObjectSpritesRebuilt(): void {
    if (this.pinnedInspector && !this.editRuntime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)) {
      this.pinnedInspector = null;
    }
    this.renderPressurePlatePanel();
    this.renderContainerContentsPanel();
  }

  beginFocusedPressurePlateConnection(): void {
    const focused = this.getFocusedPressurePlate();
    if (!focused) {
      this.pressurePlateStatusText = 'Hover or place a pressure plate first.';
      this.renderPressurePlatePanel();
      return;
    }

    this.beginPressurePlateConnection(focused.instanceId, false);
  }

  clearFocusedPressurePlateConnection(): void {
    const focused = this.getFocusedPressurePlate();
    if (!focused || !canPlacedObjectTriggerOtherObjects(focused)) {
      return;
    }

    if (this.editRuntime.setPressurePlateTarget(focused.instanceId, null)) {
      this.pressurePlateStatusText = 'Pressure plate link cleared.';
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
    this.pressurePlateStatusText = 'Pressure plate left unlinked for now.';
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
      this.pinnedInspector?.kind === 'container' && !connectMode ? null : this.getFocusedPressurePlate();
    if (source && (editorState.paletteMode === 'objects' || connectMode)) {
      const target = this.editRuntime.getPlacedObjectByInstanceId(source.triggerTargetInstanceId ?? null);
      const eligibleTargetCount = this.editRuntime.getPressurePlateEligibleTargets(source.instanceId).length;
      this.renderInspector({
        ...hiddenState,
        visible: true,
        pressureVisible: true,
        pressureStatusText:
          this.pressurePlateStatusText ??
          (connectMode
            ? eligibleTargetCount > 0
              ? 'Click a door, metal door, cage, or chest to link this pressure plate.'
              : 'No door, metal door, cage, or chest is in this room yet.'
            : target
              ? `Linked to ${this.getPressurePlateTargetLabel(target.id)}.`
              : 'This pressure plate is not linked yet.'),
        pressureConnectHidden: connectMode,
        pressureConnectDisabled: connectMode || eligibleTargetCount === 0,
        pressureConnectTitle: eligibleTargetCount === 0 ? 'Add a door, metal door, cage, or chest first.' : '',
        pressureClearHidden: connectMode,
        pressureClearDisabled: !target,
        pressureDoneLaterHidden: !connectMode,
      });
      return;
    }

    const focusedContainer =
      this.pinnedInspector?.kind === 'pressure' && !connectMode ? null : this.getFocusedContainer();
    if (focusedContainer && editorState.paletteMode === 'objects' && !this.connectingPressurePlateInstanceId) {
      const selectedObject = editorState.selectedObjectId ? getObjectById(editorState.selectedObjectId) : null;
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

    this.renderInspector(hiddenState);
  }

  private beginPressurePlateConnection(triggerInstanceId: string, autoPlaced: boolean): void {
    const trigger = this.editRuntime.getPlacedObjectByInstanceId(triggerInstanceId);
    if (!trigger || !canPlacedObjectTriggerOtherObjects(trigger)) {
      return;
    }

    this.focusedPressurePlateInstanceId = trigger.instanceId;
    this.connectingPressurePlateInstanceId = trigger.instanceId;
    this.pinInspector('pressure', trigger.instanceId);
    const eligibleTargets = this.editRuntime.getPressurePlateEligibleTargets(trigger.instanceId);
    this.pressurePlateStatusText =
      eligibleTargets.length > 0
        ? autoPlaced
          ? 'Pressure plate placed. Click a door, metal door, cage, or chest to link it.'
          : 'Click a door, metal door, cage, or chest to link this pressure plate.'
        : 'No door, metal door, cage, or chest is in this room yet. You can link this pressure plate later.';
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
      (placed) => canPlacedObjectBePressurePlateTarget(placed) && placed.instanceId !== source.instanceId,
    );
    if (!target) {
      this.pressurePlateStatusText = 'Pick a door, metal door, cage, or chest in this room.';
      this.renderPressurePlatePanel();
      return true;
    }

    if (this.editRuntime.setPressurePlateTarget(source.instanceId, target.instanceId)) {
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = source.instanceId;
      this.pinInspector('pressure', source.instanceId);
      this.pressurePlateStatusText = `Pressure plate linked to ${this.getPressurePlateTargetLabel(target.id)}.`;
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
    this.pinInspector('container', focused.instanceId);
    const selectedObject = editorState.selectedObjectId ? getObjectById(editorState.selectedObjectId) : null;
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

  private pinInspector(kind: 'pressure' | 'container', instanceId: string): void {
    this.pinnedInspector = { kind, instanceId };
  }

  private clearPinnedInspector(): void {
    this.pinnedInspector = null;
    this.focusedPressurePlateInstanceId = null;
    this.focusedContainerInstanceId = null;
    this.pressurePlateStatusText = null;
    this.containerStatusText = null;
    this.renderInspectorUi();
  }

  private getFocusedPressurePlate(): PlacedObject | null {
    const pinnedPressureId = this.pinnedInspector?.kind === 'pressure' ? this.pinnedInspector.instanceId : null;
    const activeId =
      this.connectingPressurePlateInstanceId ?? pinnedPressureId ?? this.focusedPressurePlateInstanceId;
    const focused = this.editRuntime.getPlacedObjectByInstanceId(activeId);
    if (focused && canPlacedObjectTriggerOtherObjects(focused)) {
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

  private getConnectingPressurePlate(): PlacedObject | null {
    const focused = this.editRuntime.getPlacedObjectByInstanceId(this.connectingPressurePlateInstanceId);
    if (focused && canPlacedObjectTriggerOtherObjects(focused)) {
      return focused;
    }

    return null;
  }

  private getPressurePlateTargetLabel(objectId: string): string {
    switch (objectId) {
      case 'door_locked':
        return 'door';
      case 'door_metal':
        return 'metal door';
      case 'treasure_chest':
        return 'treasure chest';
      case 'cage':
        return 'cage';
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
    return objectId === 'cage' ? 'enemies' : 'collectibles';
  }
}
