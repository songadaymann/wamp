import { describe, expect, it } from 'vitest';
import { createPartykitIdentityToken, verifyPartykitIdentityToken } from '../presence/identityToken';
import { canSendRoomEmote, isRoomEmoteId, sharesRoomEmoteAudience } from './roomEmotes';

const identity = { userId: 'student-1', displayName: 'Student', avatarId: 'default-player' };
describe('fixed emote permissions and signed classroom scope', () => {
  it('round trips only the server-issued authenticated school scope and mute', async () => {
    const { token } = await createPartykitIdentityToken(identity, 'auth', 'test-secret', {
      roomChat: 'school', classroomId: 'class-a', emotesMuted: true,
    });
    const claims = await verifyPartykitIdentityToken(token, 'test-secret');
    expect(claims).toMatchObject({ classroomId: 'class-a', emotesMuted: true });
    expect(canSendRoomEmote(claims!)).toBe(false);
  });
  it('does not retain a classroom on a guest or a public token', async () => {
    for (const source of ['guest', 'auth'] as const) {
      const { token } = await createPartykitIdentityToken(
        { ...identity, userId: source === 'guest' ? 'guest-abcd-0000-0000' : identity.userId },
        source, 'test-secret', { classroomId: 'class-a' },
      );
      expect((await verifyPartykitIdentityToken(token, 'test-secret'))?.classroomId).toBeUndefined();
    }
  });
  it('permits guests and scoped students, keeps mutes and legacy school tokens closed', () => {
    expect(canSendRoomEmote({ source: 'guest' })).toBe(true);
    expect(canSendRoomEmote({ source: 'auth', roomChat: 'school', classroomId: 'a' })).toBe(true);
    expect(canSendRoomEmote({ source: 'auth', roomChat: 'school' })).toBe(false);
    expect(canSendRoomEmote({ source: 'auth', roomChat: 'muted' })).toBe(false);
  });
  it('separates classrooms in both directions from the public and each other', () => {
    const audiences = [{ school: false }, { school: true },
      { school: true, classroomId: 'a' }, { school: true, classroomId: 'b' }];
    for (const [i, sender] of audiences.entries()) for (const [j, recipient] of audiences.entries()) {
      expect(sharesRoomEmoteAudience(sender, recipient)).toBe((i === 0 && j === 0) || (i >= 2 && i === j));
    }
  });
  it('accepts exactly the three fixed IDs, never arbitrary text or prototype keys', () => {
    for (const id of ['wave', 'heart', 'gg']) expect(isRoomEmoteId(id)).toBe(true);
    for (const id of ['hi', '__proto__', 'constructor', null, {}, 1]) expect(isRoomEmoteId(id)).toBe(false);
  });
});
