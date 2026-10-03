import { describe, expect, it } from 'vitest';
import { canonicalMailbox, networkKeyForIp } from './rateLimit';

describe('rate limit keys', () => {
  it('groups an IPv6 /64 and keeps IPv4 per address', () => {
    expect(networkKeyForIp('2001:db8:1:2::1')).toBe(networkKeyForIp('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(networkKeyForIp('2001:db8:1:3::1')).not.toBe(networkKeyForIp('2001:db8:1:2::1'));
    expect(networkKeyForIp('1.2.3.4')).toBe(networkKeyForIp('::ffff:1.2.3.4'));
    expect(networkKeyForIp('1.2.3.4')).not.toBe(networkKeyForIp('1.2.3.5'));
  });

  it('treats plus-tags and Gmail dots as one inbox', () => {
    expect(canonicalMailbox('v.ic.tim+news@gmail.com')).toBe('victim@gmail.com');
    expect(canonicalMailbox('victim@googlemail.com')).toBe('victim@gmail.com');
    expect(canonicalMailbox('first.last+x@example.com')).toBe('first.last@example.com');
  });
});
