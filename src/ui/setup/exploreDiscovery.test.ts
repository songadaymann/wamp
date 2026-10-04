import { describe, expect, it, vi } from 'vitest';
import type { RoomDiscoveryEntry, RoomDiscoveryResponse } from '../../runs/model';
import { loadExploreDiscovery } from './exploreDiscovery';

function response(featured: number, other = 0): RoomDiscoveryResponse {
  return { difficultyFilter: null, sort: 'featured', results:
    Array.from({ length: featured + other }, (_, index) => ({ featured: index < featured }) as RoomDiscoveryEntry) };
}

describe('Explore default and lifecycle', () => {
  it('chooses Featured at eight current featured rooms', async () => {
    const loadRoomDiscovery = vi.fn(async () => response(8));
    const result = await loadExploreDiscovery({ loadRoomDiscovery }, null, 'featured', true, () => true);
    expect(result?.sort).toBe('featured');
    expect(loadRoomDiscovery).toHaveBeenCalledOnce();
  });
  it('falls back to Popular below eight, counting only actual featured entries', async () => {
    const loadRoomDiscovery = vi.fn().mockResolvedValueOnce(response(7, 41))
      .mockResolvedValueOnce({ ...response(0, 48), sort: 'popular' });
    const result = await loadExploreDiscovery({ loadRoomDiscovery }, null, 'featured', true, () => true);
    expect(result?.sort).toBe('popular');
    expect(loadRoomDiscovery).toHaveBeenNthCalledWith(2, null, 'popular', 48, false);
  });
  it('honours a deliberate Featured selection and its difficulty filter', async () => {
    const loadRoomDiscovery = vi.fn(async () => response(0));
    await loadExploreDiscovery({ loadRoomDiscovery }, 'easy', 'featured', false, () => true);
    expect(loadRoomDiscovery).toHaveBeenCalledExactlyOnceWith('easy', 'featured', 48, false);
  });
  it('stops before fallback when the original request is no longer current', async () => {
    const loadRoomDiscovery = vi.fn(async () => response(0));
    expect(await loadExploreDiscovery({ loadRoomDiscovery }, null, 'featured', true, () => false)).toBeNull();
    expect(loadRoomDiscovery).toHaveBeenCalledOnce();
  });
  it('discards a Popular result when the modal closes or reopens during fallback', async () => {
    let current = true;
    const loadRoomDiscovery = vi.fn().mockResolvedValueOnce(response(0))
      .mockImplementationOnce(async () => { current = false; return response(0, 48); });
    expect(await loadExploreDiscovery({ loadRoomDiscovery }, null, 'featured', true, () => current)).toBeNull();
  });
  it('includes goal-less rooms only in an unfiltered Newest request', async () => {
    const loadRoomDiscovery = vi.fn(async () => response(0));
    await loadExploreDiscovery({ loadRoomDiscovery }, null, 'newest', false, () => true);
    expect(loadRoomDiscovery).toHaveBeenCalledWith(null, 'newest', 48, true);
  });
});
