import { describe, expect, it } from 'vitest';
import { friendlyError } from './friendlyError';

describe('friendly errors', () => {
  it.each(['Failed to fetch', 'Load failed', 'Unexpected token < in JSON', 'HTTP 503', '{"error":"server"}'])
    ('replaces transport details (%s) with an action and next step', (message) => {
      expect(friendlyError('load your profile', { error: new Error(message) }))
        .toBe("Couldn't load your profile. Please try again.");
    });
  it('preserves useful server validation and permission explanations', () => {
    expect(friendlyError('create a playlist', { error: new Error('This playlist URL is already taken.') }))
      .toBe('This playlist URL is already taken. Please try again.');
    expect(friendlyError('save your profile', { error: new Error('Sign in to save your profile'), nextStep: 'Sign in, then save again.' }))
      .toBe('Sign in to save your profile. Sign in, then save again.');
  });
});
