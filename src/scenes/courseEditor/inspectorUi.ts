import { getObjectById, type GameObjectConfig } from '../../config';
import type { EditorInspectorState } from '../editor/uiBridge';

export interface PressurePlateInspectorOptions {
  statusText: string | null;
  connectMode: boolean;
  targetSummary: string | null;
  eligibleTargetCount: number;
  connectTitle?: string;
  allowReconnectWithTarget?: boolean;
}

export interface ContainerInspectorOptions {
  containerObjectId: string;
  statusText: string | null;
  selectedObject: GameObjectConfig | null;
  selectedLooksLikeContents: boolean;
  canStoreSelected: boolean;
  currentContentsLabel: string | null;
  hasContents: boolean;
}

export function createEmptyCourseInspectorState(): EditorInspectorState {
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
    swordsmanObjectiveModeValue: 'duel',
    swordsmanObjectiveModeDisabled: true,
    swordsmanDefeatModeValue: 'defeatable',
    swordsmanDefeatModeDisabled: true,
  };
}

export function buildPressurePlateInspectorState(
  options: PressurePlateInspectorOptions
): EditorInspectorState {
  const targetExists = Boolean(options.targetSummary);
  const canConnect = options.eligibleTargetCount > 0;

  return {
    ...createEmptyCourseInspectorState(),
    visible: true,
    pressureVisible: true,
    pressureStatusText:
      options.statusText ??
      (options.connectMode
        ? canConnect
          ? 'Click a door, barricade, cage, or chest anywhere in this course to link this pressure plate.'
          : 'No door, barricade, cage, or chest is in this course yet.'
        : options.targetSummary
          ? `Linked to ${options.targetSummary}.`
          : 'This pressure plate is not linked yet.'),
    pressureConnectHidden: options.connectMode || (targetExists && !options.allowReconnectWithTarget),
    pressureConnectDisabled: options.connectMode || !canConnect,
    pressureConnectTitle: canConnect
      ? ''
      : options.connectTitle ?? 'Add a door, metal door, cage, or chest to this course first.',
    pressureClearHidden: options.connectMode,
    pressureClearDisabled: !targetExists,
    pressureDoneLaterHidden: !options.connectMode,
  };
}

export function buildContainerInspectorState(
  options: ContainerInspectorOptions
): EditorInspectorState {
  return {
    ...createEmptyCourseInspectorState(),
    visible: true,
    containerVisible: true,
    containerStatusText:
      options.statusText ??
      getContainerInspectorStatusText(options),
    containerClearDisabled: !options.hasContents,
    containerClearTitle: options.hasContents ? '' : 'This container is empty.',
  };
}

export function getPressurePlateTargetLabel(objectId: string): string {
  switch (objectId) {
    case 'door_locked':
      return 'door';
    case 'door_metal':
      return 'metal door';
    case 'trapdoor_locked':
      return 'trapdoor';
    case 'trapdoor_metal':
      return 'metal trapdoor';
    case 'treasure_chest':
      return 'treasure chest';
    case 'cage':
      return 'cage';
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

export function getContainerLabel(objectId: string): string {
  return objectId === 'cage' ? 'cage' : 'treasure chest';
}

export function getContainerName(objectId: string): string {
  return objectId === 'cage' ? 'This cage' : 'This treasure chest';
}

export function getContainerAcceptedContentsLabel(objectId: string): string {
  return objectId === 'cage' ? 'enemies or crates' : 'collectibles';
}

function getContainerInspectorStatusText(options: ContainerInspectorOptions): string {
  const selectedObject = options.selectedObject;
  const containerLabel = getContainerLabel(options.containerObjectId);
  const containerName = getContainerName(options.containerObjectId);
  const acceptedContentsLabel = getContainerAcceptedContentsLabel(options.containerObjectId);

  if (options.canStoreSelected && selectedObject) {
    return `Click this ${containerLabel} to stash ${selectedObject.name} inside.`;
  }

  if (options.selectedLooksLikeContents && selectedObject) {
    return `${containerName} can only hold ${acceptedContentsLabel}.`;
  }

  if (options.currentContentsLabel) {
    return `${containerName} currently holds ${options.currentContentsLabel}. Select a ${acceptedContentsLabel} and click it to change the contents.`;
  }

  return `${containerName} is empty. Select a ${acceptedContentsLabel} from the object list, then click it to fill the container.`;
}
