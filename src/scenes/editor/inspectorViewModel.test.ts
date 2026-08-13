import { describe, expect, it } from 'vitest';
import type { GameObjectConfig } from '../../config';
import {
  buildContainerInspectorState,
  buildPressurePlateInspectorState,
  createEmptyEditorInspectorState,
} from './inspectorViewModel';

describe('shared editor inspector view models', () => {
  it('creates one stable empty state for ordinary and expanded editors', () => {
    expect(createEmptyEditorInspectorState()).toMatchObject({
      visible: false,
      pressureConnectHidden: true,
      containerClearDisabled: true,
      swordsmanObjectiveModeValue: 'duel',
      policeBehaviorModeValue: 'hunter',
      npcModeValue: 'idle',
    });
  });

  it('derives pressure connection controls from mode, targets, and reconnect policy', () => {
    const base = {
      statusText: null,
      connectMode: false,
      targetSummary: 'door in Cell 2',
      eligibleTargetCount: 2,
    };
    expect(buildPressurePlateInspectorState(base)).toMatchObject({
      visible: true,
      pressureVisible: true,
      pressureConnectHidden: true,
      pressureClearDisabled: false,
      pressureStatusText: 'Linked to door in Cell 2.',
    });
    expect(buildPressurePlateInspectorState({ ...base, allowReconnectWithTarget: true })).toMatchObject({
      pressureConnectHidden: false,
    });
    expect(buildPressurePlateInspectorState({ ...base, connectMode: true })).toMatchObject({
      pressureConnectHidden: true,
      pressureClearHidden: true,
      pressureDoneLaterHidden: false,
    });
  });

  it('derives all container guidance branches and honors explicit status', () => {
    const selectedObject = { id: 'coin_gold', name: 'Gold Coin' } as GameObjectConfig;
    const base = {
      containerObjectId: 'treasure_chest',
      statusText: null,
      selectedObject,
      selectedLooksLikeContents: true,
      canStoreSelected: true,
      currentContentsLabel: null,
      hasContents: false,
    };
    expect(buildContainerInspectorState(base)).toMatchObject({
      containerStatusText: 'Click this treasure chest to stash Gold Coin inside.',
      containerClearDisabled: true,
      containerClearTitle: 'This container is empty.',
    });
    expect(buildContainerInspectorState({
      ...base,
      statusText: 'Saved.',
      hasContents: true,
    })).toMatchObject({
      containerStatusText: 'Saved.',
      containerClearDisabled: false,
      containerClearTitle: '',
    });
  });
});
