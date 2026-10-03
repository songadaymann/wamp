// Sent with HTTP 409 when an editor saves or publishes a room that was saved somewhere else
// (another tab or device) after that editor loaded it. The editor matches on this exact text.
export const ROOM_EDIT_CONFLICT_MESSAGE = 'This room was changed in another tab or device since you opened it.';
