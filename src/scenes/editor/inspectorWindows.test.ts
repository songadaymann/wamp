import { describe, expect, it } from 'vitest';
import { inspectorWindowLabel, type InspectorWindowSource } from './inspectorWindows';

const closed: InspectorWindowSource = {
  visible: false,
  ballVisible: false,
  triangleVisible: false,
  npcVisible: false,
  swordsmanVisible: false,
  policeVisible: false,
  containerVisible: false,
  pressureVisible: false,
  bossVisible: false,
};

describe('inspector option windows', () => {
  it('names the open object and stays closed when nothing is selected', () => {
    expect(inspectorWindowLabel(closed)).toBeNull();
    expect(inspectorWindowLabel({ ...closed, visible: true, ballVisible: true })).toEqual({
      kind: 'ball',
      title: 'Ball options',
    });
    expect(inspectorWindowLabel({
      ...closed,
      visible: true,
      npcVisible: true,
      bossVisible: true,
    })).toEqual({ kind: 'npc', title: 'NPC options' });
  });
});
