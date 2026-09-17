import { describe, expect, it } from 'vitest';
import {
  fallbackAgreementName,
  isPlaceholderName,
  resolveAgreementName,
} from './agreementName';

const CONTEXT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('resolveAgreementName', () => {
  // The reported bug, stated as a test: the creator typed a name, the invitee
  // saw "Agreement".
  it('shows the creator’s name on the joining node', () => {
    expect(
      resolveAgreementName({
        fromContract: 'NDA with Acme',
        stored: 'Agreement',
        contextId: CONTEXT_ID,
      }),
    ).toBe('NDA with Acme');
  });

  it('prefers the contract over the invitation’s hint', () => {
    // The hint sits outside the signature, so anybody can change it. It never
    // wins against replicated contract state.
    expect(
      resolveAgreementName({
        fromContract: 'NDA with Acme',
        fromInvitation: 'Free money, click here',
        contextId: CONTEXT_ID,
      }),
    ).toBe('NDA with Acme');
  });

  it('falls back to the invitation hint while the contract has not synced', () => {
    expect(
      resolveAgreementName({
        fromContract: undefined,
        fromInvitation: 'NDA with Acme',
        contextId: CONTEXT_ID,
      }),
    ).toBe('NDA with Acme');
  });

  it('falls back to a stored name before inventing one', () => {
    expect(
      resolveAgreementName({ stored: 'Series A', contextId: CONTEXT_ID }),
    ).toBe('Series A');
  });

  it('never shows a bare placeholder when it has an id to show instead', () => {
    expect(
      resolveAgreementName({ stored: 'Agreement', contextId: CONTEXT_ID }),
    ).toBe('Agreement a1b2c3d4…');
  });

  it('keeps a placeholder-looking CONTRACT name, because every node agrees on it', () => {
    // If the creator really called it "Agreement", showing "Agreement" is
    // correct — and identical everywhere, which is the property that matters.
    expect(
      resolveAgreementName({
        fromContract: 'Agreement',
        stored: 'Agreement',
        contextId: CONTEXT_ID,
      }),
    ).toBe('Agreement');
  });

  it('ignores blank and whitespace-only values', () => {
    expect(
      resolveAgreementName({
        fromContract: '   ',
        fromInvitation: '',
        stored: null,
        contextId: CONTEXT_ID,
      }),
    ).toBe('Agreement a1b2c3d4…');
  });

  it('trims', () => {
    expect(
      resolveAgreementName({
        fromContract: '  Lease  ',
        contextId: CONTEXT_ID,
      }),
    ).toBe('Lease');
  });
});

describe('isPlaceholderName', () => {
  it('recognises the generic labels earlier builds stored', () => {
    for (const name of ['Agreement', 'agreement', 'default', 'Untitled', '']) {
      expect(isPlaceholderName(name)).toBe(true);
    }
  });

  it('recognises the truncated-id shape, in both spellings', () => {
    expect(isPlaceholderName('Agreement a1b2c3d4…')).toBe(true);
    expect(isPlaceholderName('Agreement a1b2c3d4...')).toBe(true);
  });

  it('recognises a name that is just the context id', () => {
    expect(isPlaceholderName(CONTEXT_ID, CONTEXT_ID)).toBe(true);
  });

  it('leaves a real name alone', () => {
    expect(isPlaceholderName('NDA with Acme')).toBe(false);
    expect(isPlaceholderName('Agreement with Acme')).toBe(false);
  });
});

describe('fallbackAgreementName', () => {
  it('includes the id so two unnamed agreements do not look identical', () => {
    expect(fallbackAgreementName(CONTEXT_ID)).toBe('Agreement a1b2c3d4…');
    expect(fallbackAgreementName('ffffffffdeadbeef')).toBe(
      'Agreement ffffffff…',
    );
  });

  it('copes with no id at all', () => {
    expect(fallbackAgreementName('')).toBe('Untitled agreement');
  });
});
