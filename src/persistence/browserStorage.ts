export const ROOM_STORAGE_PREFIX = 'everybodys-platformer:room:';

export function clearLocalRoomStorage(storage: Storage = window.localStorage): number {
  const keysToDelete: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(ROOM_STORAGE_PREFIX)) {
      continue;
    }

    keysToDelete.push(key);
  }

  for (const key of keysToDelete) {
    storage.removeItem(key);
  }

  return keysToDelete.length;
}
