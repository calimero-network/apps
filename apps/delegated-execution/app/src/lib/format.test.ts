import { describe, expect, it } from 'vitest';

import { errorText, parseJson, pretty, short } from './format.js';

describe('short', () => {
  it('keeps both ends so two hashes never look alike', () => {
    const a = `${'a'.repeat(56)}0000000f`;
    const b = `${'a'.repeat(56)}0000000e`;
    // A prefix-only abbreviation would render these identically, which in this
    // demo means "your account" and "the node's account" showing the same text.
    expect(short(a)).not.toBe(short(b));
    expect(short(a)).toBe('aaaaaaaa…0000000f');
  });

  it('leaves a value short enough to show alone', () => {
    expect(short('abcd')).toBe('abcd');
  });
});

describe('parseJson', () => {
  it('treats an empty box as an empty object, not as an error', () => {
    // A method taking no arguments is spelled `{}`, and making the user type it
    // would be the most common way to fail this demo at the last step.
    expect(parseJson('   ', 'arguments')).toEqual({ value: {}, error: null });
  });

  it('names the field it could not parse', () => {
    const result = parseJson('{oops', 'arguments');
    expect(result.value).toBeNull();
    expect(result.error).toContain('arguments is not valid JSON');
  });

  it('parses the argument shape the write step sends', () => {
    expect(parseJson('{"key":"k","value":"v"}', 'arguments').value).toEqual({
      key: 'k',
      value: 'v',
    });
  });
});

describe('pretty', () => {
  it('passes a string through rather than quoting it', () => {
    expect(pretty('already text')).toBe('already text');
  });

  it('survives a BigInt instead of throwing', () => {
    // Reachable rather than defensive: a nonce is a BigInt, and
    // `JSON.stringify` throws a TypeError on one.
    expect(pretty(7n)).toBe('7');
  });
});

describe('errorText', () => {
  it("prefers a refusal's message, which names the failing precondition", () => {
    const refusal = {
      reason: 'author is not a member of the context',
      message: 'relay refused the intent (HTTP 403): author is not a member of the context',
    };
    expect(errorText(refusal)).toContain('not a member');
  });

  it("appends an HTTP error's body, where a node puts the detail", () => {
    const httpError = { message: 'HTTP 401 Unauthorized', body: 'unknown audience' };
    expect(errorText(httpError)).toBe('HTTP 401 Unauthorized: unknown audience');
  });

  it('falls back to the value itself', () => {
    expect(errorText('plain string')).toBe('plain string');
  });
});
