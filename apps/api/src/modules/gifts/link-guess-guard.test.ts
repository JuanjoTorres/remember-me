import { describe, expect, it } from 'vitest';
import { clientOf } from './link-guess-guard.js';

describe('clientOf', () => {
  it('takes an IPv4 address as one client, also inside IPv6', () => {
    expect(clientOf('203.0.113.7')).toBe('203.0.113.7');
    expect(clientOf('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
    expect(clientOf('203.0.113.7')).not.toBe(clientOf('203.0.113.8'));
  });

  it('takes every address of one IPv6 network as the same client', () => {
    const network = clientOf('2001:db8:85a3:1:aaaa:bbbb:cccc:dddd');
    expect(network).toBe('2001:db8:85a3:1');
    expect(clientOf('2001:db8:85a3:1::1')).toBe(network);
    expect(clientOf('2001:0DB8:85A3:0001:1111:2222:3333:4444')).toBe(network);
    expect(clientOf('2001:db8:85a3:2::1')).not.toBe(network);
  });

  it('reads the short forms of an address', () => {
    expect(clientOf('2001:db8::1')).toBe('2001:db8:0:0');
    expect(clientOf('::1')).toBe('0:0:0:0');
    expect(clientOf('fe80::')).toBe('fe80:0:0:0');
  });
});
