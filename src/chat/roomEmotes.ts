import type { PartyKitIdentityTokenClaims } from '../presence/identityToken';

/** Closed vocabulary: the server chooses bubble text, never the packet. */
export const ROOM_EMOTES = {
  wave: { label: 'Wave', text: '👋' },
  heart: { label: 'Heart', text: '♥' },
  gg: { label: 'GG', text: 'GG' },
} as const;
export type RoomEmoteId = keyof typeof ROOM_EMOTES;
export function isRoomEmoteId(value: unknown): value is RoomEmoteId {
  return value === 'wave' || value === 'heart' || value === 'gg';
}

export function canSendRoomEmote(claims: Pick<PartyKitIdentityTokenClaims,
  'source' | 'roomChat' | 'classroomId' | 'emotesMuted'>): boolean {
  if (claims.emotesMuted || claims.roomChat === 'muted') return false;
  return claims.roomChat !== 'school' || (claims.source === 'auth' && Boolean(claims.classroomId));
}

/** Missing classroom claims fail closed, including tokens issued before emotes. */
export function sharesRoomEmoteAudience(
  sender: { school: boolean; classroomId?: string },
  recipient: { school: boolean; classroomId?: string },
): boolean {
  if (!sender.school && !recipient.school) return true;
  return sender.school && recipient.school && Boolean(sender.classroomId) &&
    sender.classroomId === recipient.classroomId;
}
