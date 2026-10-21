import { describe, expect, it } from 'vitest';
import { WalletRequestNotSubmittedError } from '../auth/walletTransaction';
import { roomWalletErrorMessage } from './roomWalletError';
describe('readable room wallet failures', () => {
  it.each(['cancelled', 'insufficient-funds', 'price-changed', 'authorization-expired', 'network-switch', 'wallet-mismatch'] as const)('maps %s without exposing the provider dump', reason => {
    const error = new WalletRequestNotSubmittedError(reason, 'Request Arguments secret calldata 0x123456789abcdef Docs: viem');
    const message = roomWalletErrorMessage(error, 'mint', 'Base', '0x2222222222222222222222222222222222222222');
    expect(message).not.toMatch(/calldata|viem|Request Arguments|0x1234/); expect(message).toMatch(/try again|Try again|cancelled/i);
    if (reason === 'wallet-mismatch') expect(message).toContain('0x2222…2222');
  });
  it('handles nested/cyclic errors without displaying unknown internals', () => {
    const error = Object.assign(new Error('RPC PRIVATE DETAILS 0xabcdef'), { cause: null as unknown }); error.cause = error;
    expect(roomWalletErrorMessage(error, 'artwork')).toBe('Could not add the room artwork. Your room is still collected. Try Add/update artwork again.');
    expect(roomWalletErrorMessage({ cause: { code: 4001 } }, 'mint')).toContain('You cancelled');
  });
});
