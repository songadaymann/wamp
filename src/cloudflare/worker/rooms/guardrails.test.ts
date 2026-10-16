import { describe, expect, it } from 'vitest';
import { createDefaultRoomVideo } from '../../../roomVideo/model';
import { assertRoomVideoTrust } from './guardrails';

const video = createDefaultRoomVideo('dQw4w9WgXcQ', 16 / 9);

describe('room video trust guard', () => {
  it('accepts a video from builder trust level 1', () => {
    expect(() => assertRoomVideoTrust('T1', { video }, null)).not.toThrow();
  });

  it('rejects a new or edited video below builder trust level 1', () => {
    expect(() => assertRoomVideoTrust('T0', { video }, null)).toThrow(/trust level 1/);
    expect(() => assertRoomVideoTrust('T0', { video: { ...video, snap: true } }, { video })).toThrow(/trust level 1/);
  });

  it('lets a builder below trust level 1 keep or remove the stored video', () => {
    expect(() => assertRoomVideoTrust('T0', { video }, { video })).not.toThrow();
    expect(() => assertRoomVideoTrust('T0', { video: null }, { video })).not.toThrow();
  });
});
