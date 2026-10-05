import { beforeEach, describe, expect, it, vi } from 'vitest';
const repository = vi.hoisted(() => ({ load: vi.fn(), expanded: vi.fn() }));
vi.mock('./repository', () => ({ createBuildPromptRepository: () => ({ load: repository.load }) }));
vi.mock('../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({ loadExpandedRoom: repository.expanded }) }));
import { matchesPromptRoom, verifyPromptPlayback } from './playback';
import type { RoomSequenceEntry } from '../ui/setup/roomSequenceEvents';
const entry: RoomSequenceEntry = { roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, roomVersion: 1, buildPrompt: { slug: 'fixture', targetKey: 'room:0,0', offset: 48 } };
beforeEach(() => { vi.clearAllMocks(); });
describe('submitted publication playback', () => {
  it('requires the actually loaded public version rather than a summary or title', () => {
    const selected = { roomId: '0,0', coordinates: { x: 0, y: 0 }, state: 'published' as const, courseId: null, courseTitle: null, courseGoalType: null, courseRoomCount: null, publishedVersion: 1 };
    expect(matchesPromptRoom(entry, selected)).toBe(true); expect(matchesPromptRoom(entry, { ...selected, publishedVersion: 2 })).toBe(false); expect(matchesPromptRoom(entry, { ...selected, state: 'draft' })).toBe(false); expect(matchesPromptRoom(entry, undefined)).toBe(false);
  });
  it('refreshes the original page and rejects an entry changed since browsing', async () => {
    repository.load.mockResolvedValue({ entries: [{ targetKey: 'room:0,0', version: 2, available: true }] });
    await expect(verifyPromptPlayback(entry)).rejects.toThrow('updated or removed'); expect(repository.load).toHaveBeenCalledExactlyOnceWith('fixture', 48);
  });
  it('also checks the whole expanded publication when its anchor version stays the same', async () => {
    const expanded = { ...entry, expandedRoomId: 'level', expandedRoomVersion: 3, buildPrompt: { slug: 'fixture', targetKey: 'expanded_room:level', offset: 0 } };
    repository.load.mockResolvedValue({ entries: [{ targetKey: 'expanded_room:level', version: 3, available: true }] }); repository.expanded.mockResolvedValue({ version: 4 });
    await expect(verifyPromptPlayback(expanded)).rejects.toThrow('expanded entry has changed'); repository.expanded.mockResolvedValue({ version: 3 }); await expect(verifyPromptPlayback(expanded)).resolves.toBeUndefined();
  });
});
