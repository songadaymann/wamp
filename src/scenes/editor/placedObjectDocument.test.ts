import { describe, expect, it } from 'vitest';
import type { PlacedObject } from '../../config';
import {
  clonePlacedObjectDocument,
  removePlacedObjectFromDocument,
} from './placedObjectDocument';

describe('placed object document', () => {
  it('deep-clones link arrays without mutating the source', () => {
    const source = [object('platform', 'moving_platform', ['target'])];
    const clone = clonePlacedObjectDocument(source);
    clone[0].linkedTargetInstanceIds!.push('other');
    expect(source[0].linkedTargetInstanceIds).toEqual(['target']);


  });

  it('removes a target and reconciles single and path links without mutating input', () => {
    const source = [
      object('target', 'coin_gold'),
      { ...object('trigger', 'floor_trigger'), triggerTargetInstanceId: 'target' },
      { ...object('platform', 'moving_platform', ['target', 'other']), triggerTargetInstanceId: 'target' },
    ];
    const result = removePlacedObjectFromDocument(source, 'target');
    expect(result.removed?.instanceId).toBe('target');
    expect(result.placedObjects.map(({ instanceId }) => instanceId)).toEqual(['trigger', 'platform']);
    expect(result.placedObjects[0]).toMatchObject({
      triggerTargetInstanceId: null,
      linkedTargetInstanceIds: null,
    });
    expect(result.placedObjects[1]).toMatchObject({
      triggerTargetInstanceId: 'other',
      linkedTargetInstanceIds: ['other'],
    });
    expect(source[1].triggerTargetInstanceId).toBe('target');
    expect(source[2].linkedTargetInstanceIds).toEqual(['target', 'other']);
  });
});

function object(
  instanceId: string,
  id: string,
  linkedTargetInstanceIds: string[] | null = null,
): PlacedObject {
  return {
    instanceId,
    id,
    x: 16,
    y: 16,
    linkedTargetInstanceIds,
  };
}
