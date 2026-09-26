// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { base32Decode, parseTotp, secondsRemaining, totpCode } from './totp';

// RFC 6238 Appendix B test vectors. The seed is ASCII "12345678901234567890"
// (SHA-1), base32-encoded.
const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 vectors (8 digits)', async () => {
    const p = {
      secret: RFC_SEED,
      digits: 8,
      period: 30,
      algorithm: 'SHA-1' as const,
    };
    expect(await totpCode(p, 59_000)).toBe('94287082');
    expect(await totpCode(p, 1_111_111_109_000)).toBe('07081804');
    expect(await totpCode(p, 1_234_567_890_000)).toBe('89005924');
    expect(await totpCode(p, 20_000_000_000_000)).toBe('65353130');
  });

  it('decodes base32 with spaces and lowercase', () => {
    expect(Array.from(base32Decode('mzxw 6==='))).toEqual([0x66, 0x6f, 0x6f]);
  });

  it('parses an otpauth URI', () => {
    const p = parseTotp(
      'otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6&period=30',
    );
    expect(p).toMatchObject({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'GitHub',
      account: 'alice',
      digits: 6,
      period: 30,
      algorithm: 'SHA-1',
    });
  });

  it('parses a bare seed and rejects junk', () => {
    expect(parseTotp('JBSWY3DPEHPK3PXP')?.digits).toBe(6);
    expect(parseTotp('not a seed!')).toBeNull();
    expect(parseTotp('otpauth://hotp/x?secret=JBSWY3DP')).toBeNull();
    expect(parseTotp('')).toBeNull();
  });

  it('counts down the period', () => {
    expect(secondsRemaining(30, 0)).toBe(30);
    expect(secondsRemaining(30, 29_000)).toBe(1);
  });
});
