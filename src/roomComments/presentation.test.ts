import { describe, expect, it } from 'vitest';
import { formatAccountIdentity } from '../auth/displayIdentity';
import { getCommentsSignature } from './presentation';
describe('account identity presentation', () => {
  it('keeps shared display names readable and includes unique handles when available', () => {
    expect(formatAccountIdentity('Same name', 'first')).toBe('Same name (@first)');
    expect(formatAccountIdentity('Same name', 'second')).toBe('Same name (@second)');
    expect(formatAccountIdentity('Legacy', null)).toBe('Legacy');
    expect(formatAccountIdentity('<img src=x>', 'account')).toBe('<img src=x> (@account)');
  });
  it('invalidates existing browse author text when the same comment gains or changes identity', () => {
    const comment = { id: 'same-id', createdAt: '2026-10-19T00:00:00Z', body: 'Same body', authorDisplayName: 'Shared' };
    const original = getCommentsSignature([comment]);
    expect(getCommentsSignature([{ ...comment }])).toBe(original);
    const identified = getCommentsSignature([{ ...comment, authorUsername: 'first_account' }]);
    expect(identified).not.toBe(original);
    expect(getCommentsSignature([{ ...comment, authorUsername: 'second_account' }])).not.toBe(identified);
    expect(getCommentsSignature([{ ...comment, authorDisplayName: 'Updated' }])).not.toBe(original);
  });
});
