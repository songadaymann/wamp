// Sent with HTTP 409 when an editor saves or publishes a room that was saved somewhere else
// (another tab or device) after that editor loaded it. The editor matches on this exact text.
export const ROOM_EDIT_CONFLICT_MESSAGE = 'This room was changed in another tab or device since you opened it.';

/** True for the server's 409 refusal of a save whose starting version is out of date. */
export function isRoomEditConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { status?: unknown }).status === 409
    && (error as { message?: unknown }).message === ROOM_EDIT_CONFLICT_MESSAGE;
}
