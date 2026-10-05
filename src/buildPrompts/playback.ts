import type { OverworldSelectedRoomContext } from '../ui/setup/sceneBridge';
import type { RoomSequenceEntry } from '../ui/setup/roomSequenceEvents';
import { createBuildPromptRepository } from './repository';
import { createExpandedRoomRepository } from '../expandedRooms/repository';
export function matchesPromptRoom(entry: RoomSequenceEntry, selected: OverworldSelectedRoomContext | undefined): boolean {
  return !!selected && selected.state === 'published' && selected.roomId === entry.roomId
    && selected.publishedVersion === entry.roomVersion
    && (!entry.expandedRoomId || selected.expandedRoomId === entry.expandedRoomId);
}
export async function verifyPromptPlayback(entry: RoomSequenceEntry): Promise<void> {
  if (!entry.buildPrompt) return;
  const response = await createBuildPromptRepository().load(entry.buildPrompt.slug, entry.buildPrompt.offset);
  const current = response.entries.find(row => row.targetKey === entry.buildPrompt?.targetKey);
  if (!current?.available || current.version !== (entry.expandedRoomVersion ?? entry.roomVersion)) {
    throw new Error('This entry was updated or removed. Open Build Prompt to refresh the list.');
  }
  if (entry.expandedRoomId) {
    const target = await createExpandedRoomRepository().loadExpandedRoom(entry.expandedRoomId);
    if (target.version !== entry.expandedRoomVersion) throw new Error('This expanded entry has changed. Open Build Prompt to refresh the list.');
  }
}
