export type PlayerHearts = 1 | 2 | 3;

/** Older rooms and invalid values retain the original one-hit-death rules. */
export function normalizePlayerHearts(value: unknown): PlayerHearts {
  return value === 2 || value === 3 ? value : 1;
}


/** Expanded roots own the budget; standalone summaries defer to the exact room. */
export function getPlayableMaximumHearts(input: {
  room: { playerHearts?: unknown } | null;
  course: { playerHearts?: unknown } | null;
  expandedRoom: { source: string; playerHearts?: unknown } | null;
}): PlayerHearts {
  if (input.course) return normalizePlayerHearts(input.course.playerHearts);
  if (input.expandedRoom && input.expandedRoom.source !== 'standalone_room') {
    return normalizePlayerHearts(input.expandedRoom.playerHearts);
  }
  return normalizePlayerHearts(input.room?.playerHearts);
}
