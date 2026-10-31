import { describe, expect, it } from 'vitest';
import { editorState, updateEditorState, type GameObjectConfig } from '../../config';
import {
  buildContainerInspectorState,
  buildPressurePlateInspectorState,
  buildTriangleStampInspectorState,
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

  it('derives pressure controls while using caller-provided guidance', () => {
    const base = {
      statusText: 'Linked to door in Cell 2.',
      connectTitle: '',
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

  it('shows stamp colors and orientation when the triangle tool is waiting to place', () => {
    const previous = {
      fill: editorState.triangleStampFill,
      stroke: editorState.triangleStampStroke,
      flipX: editorState.triangleStampFlipX,
      flipY: editorState.triangleStampFlipY,
      paint: editorState.trianglePaintMode,
    };
    updateEditorState({
      triangleStampFill: '#FF3366',
      triangleStampStroke: '#112233',
      triangleStampFlipX: true,
      triangleStampFlipY: true,
      trianglePaintMode: false,
    });
    try {
      expect(buildTriangleStampInspectorState()).toMatchObject({
        visible: true,
        triangleVisible: true,
        trianglePaintMode: false,
        triangleFillValue: '#FF3366',
        triangleStrokeValue: '#112233',
        triangleFlipX: true,
        triangleFlipY: true,
      });
      updateEditorState({ trianglePaintMode: true });
      expect(buildTriangleStampInspectorState()).toMatchObject({
        trianglePaintMode: true,
      });
    } finally {
      updateEditorState({
        triangleStampFill: previous.fill,
        triangleStampStroke: previous.stroke,
        triangleStampFlipX: previous.flipX,
        triangleStampFlipY: previous.flipY,
        trianglePaintMode: previous.paint,
      });
    }
  });
});
