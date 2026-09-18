import { describe, expect, it } from 'vitest';

import { errorText, hostOf, parseJson, pretty, short } from './format.js';

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

/**
 * The regression behind a blank page.
 *
 * The status strip shows the relay's host, and it did that with an inline
 * `new URL(settings.nodeUrl).host`. `URL` throws on anything without a scheme,
 * that value comes from `localStorage`, and it is typed by hand into a field
 * that has never validated it — so a stored `relay.example` threw during
 * render, which in React takes the whole page and not the one label. Worse, the
 * bad value is the persisted one, so every reload reproduced it.
 *
 * `npm run build`, `tsc -b` and the unit tests were all green throughout: none
 * of them renders the component, and the throw needs stored state to reach.
 */
describe('hostOf', () => {
  it('shortens a URL to its host', () => {
    expect(hostOf('https://relay.example/admin-api/x')).toBe('relay.example');
    expect(hostOf('http://localhost:5173')).toBe('localhost:5173');
  });

  it('does not throw on the values a person actually types', () => {
    // Each of these threw from `new URL` and blanked the page.
    expect(hostOf('relay.example')).toBe('relay.example');
    expect(hostOf(' ')).toBe(' ');
    expect(hostOf('')).toBe('');
    expect(hostOf('://nonsense')).toBe('://nonsense');
  });

  it('falls back when the URL parses but has no host', () => {
    // Not a throw: a typo'd scheme parses as an opaque path, so `.host` is ''.
    // Rendering nothing reads as "no relay" for a tab that has one, which is
    // the more misleading of the two failures.
    expect(hostOf('htp:/typo.example')).toBe('htp:/typo.example');
    expect(hostOf('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });
});
