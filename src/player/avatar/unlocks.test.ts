import { describe, expect, it } from 'vitest';
import { GAMEJEW_RED_PLAYER_AVATAR_ID } from './registry';
import { listPlayerAvatarChoicesForLevel } from './unlocks';

describe('player avatar entitlement choices', () => {
  it('hides GameJew Red from accounts without the prize entitlement', () => {
    const choices = listPlayerAvatarChoicesForLevel(99, 'default-player');

    expect(choices.some((choice) => choice.avatarId === GAMEJEW_RED_PLAYER_AVATAR_ID)).toBe(false);
  });

  it('shows GameJew Red as unlocked for entitled accounts regardless of level', () => {
    const choices = listPlayerAvatarChoicesForLevel(
      1,
      GAMEJEW_RED_PLAYER_AVATAR_ID,
      [GAMEJEW_RED_PLAYER_AVATAR_ID],
    );
    const prize = choices.find((choice) => choice.avatarId === GAMEJEW_RED_PLAYER_AVATAR_ID);

    expect(prize).toMatchObject({
      label: 'GameJew Red',
      kind: 'custom',
      unlockLevel: null,
      unlocked: true,
      selected: true,
    });
    expect(choices[0]?.avatarId).toBe(GAMEJEW_RED_PLAYER_AVATAR_ID);
  });
});
