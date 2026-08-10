import { describe, expect, it } from 'vitest';
import { isRoomHistoryAvailable } from './viewModel';

describe('editor history affordance', () => {
  it('stays available for a published room before lazy history snapshots load', () => {
    expect(isRoomHistoryAvailable(12, [])).toBe(true);
  });

  it('stays disabled for an unpublished room with no local version history', () => {
    expect(isRoomHistoryAvailable(0, [])).toBe(false);
  });
});
