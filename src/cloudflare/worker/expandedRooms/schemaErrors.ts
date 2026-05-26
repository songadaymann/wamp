export function isExpandedRoomSchemaMissingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no such (table|column):.*(expanded_rooms|expanded_room_cells|expanded_room_versions|archived_at)/i.test(error.message)
  );
}
