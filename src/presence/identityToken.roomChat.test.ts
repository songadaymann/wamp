import { describe, expect, it } from 'vitest';
import {
  canReceiveRoomChat,
  canSendRoomChat,
  createPartykitIdentityToken,
  isGeneratedGuestDisplayName,
  verifyPartykitIdentityToken,
} from './identityToken';

const identity = { userId: 'user-1', displayName: 'Ada', avatarId: 'default-player' };

describe('room chat permission in the presence identity token', () => {
  it('survives signing and verification', async () => {
    const { token } = await createPartykitIdentityToken(identity, 'auth', 'secret', { roomChat: 'school' });
    const claims = await verifyPartykitIdentityToken(token, 'secret');
    expect(claims?.roomChat).toBe('school');
    expect(canSendRoomChat(claims!)).toBe(false);
    expect(canReceiveRoomChat(claims!)).toBe(false);
  });

  it('lets only signed-in players with an ok (or legacy, missing) permission send', () => {
    expect(canSendRoomChat({ source: 'auth', roomChat: 'ok' })).toBe(true);
    expect(canSendRoomChat({ source: 'auth' })).toBe(true);
    expect(canSendRoomChat({ source: 'auth', roomChat: 'muted' })).toBe(false);
    expect(canSendRoomChat({ source: 'guest' })).toBe(false);
    expect(canReceiveRoomChat({ roomChat: 'muted' })).toBe(true);
  });

  it('accepts only auto-generated guest names', () => {
    expect(isGeneratedGuestDisplayName('Guest 9qkw')).toBe(true);
    expect(isGeneratedGuestDisplayName('jonathan')).toBe(false);
    expect(isGeneratedGuestDisplayName('Guest Jonathan')).toBe(false);
  });
});
