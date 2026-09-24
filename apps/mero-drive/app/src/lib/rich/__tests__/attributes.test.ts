import { describe, it, expect } from 'vitest';
import {
  MARK_KEYS,
  attrsToStyles,
  canonicalAttrs,
  attrsEqual,
  attrDelta,
  stylesToAttrs,
} from '../attributes';

describe('MARK_KEYS', () => {
  it('is the fixed set the backend schema accepts', () => {
    expect(MARK_KEYS).toEqual([
      'backgroundColor',
      'bold',
      'code',
      'comment',
      'italic',
      'link',
      'strike',
      'textColor',
      'underline',
    ]);
  });
});

describe('stylesToAttrs', () => {
  it('maps a boolean style to the string true', () => {
    expect(stylesToAttrs({ bold: true, italic: true })).toEqual({
      bold: 'true',
      italic: 'true',
    });
  });

  it('drops a boolean style that is false', () => {
    expect(stylesToAttrs({ bold: false, underline: true })).toEqual({
      underline: 'true',
    });
  });

  it('carries a colour style through as its string', () => {
    expect(
      stylesToAttrs({ textColor: 'red', backgroundColor: '#ffcc00' }),
    ).toEqual({ backgroundColor: '#ffcc00', textColor: 'red' });
  });

  it('adds the link href as the link attribute', () => {
    expect(stylesToAttrs({ bold: true }, 'https://example.com')).toEqual({
      bold: 'true',
      link: 'https://example.com',
    });
  });

  it('drops a style the backend schema does not declare', () => {
    expect(stylesToAttrs({ fontSize: '20px', bold: true })).toEqual({
      bold: 'true',
    });
  });

  it('sorts keys so two equal sets serialize identically', () => {
    const a = stylesToAttrs({ underline: true, bold: true, textColor: 'red' });
    const b = stylesToAttrs({ textColor: 'red', bold: true, underline: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a)).toEqual(['bold', 'textColor', 'underline']);
  });
});

describe('attrsToStyles', () => {
  it('maps the string true back to a boolean style', () => {
    expect(attrsToStyles({ bold: 'true', italic: 'true' })).toEqual({
      styles: { bold: true, italic: true },
      href: null,
    });
  });

  it('splits the link attribute out of the style set', () => {
    expect(
      attrsToStyles({ link: 'https://example.com', code: 'true' }),
    ).toEqual({ styles: { code: true }, href: 'https://example.com' });
  });

  it('keeps a colour as a string style', () => {
    expect(attrsToStyles({ textColor: 'blue' })).toEqual({
      styles: { textColor: 'blue' },
      href: null,
    });
  });

  it('ignores an attribute outside the schema', () => {
    expect(attrsToStyles({ fontSize: '20px', bold: 'true' })).toEqual({
      styles: { bold: true },
      href: null,
    });
  });
});

describe('canonicalAttrs', () => {
  it('sorts keys and drops empty values', () => {
    const canonical = canonicalAttrs({ textColor: '', bold: 'true' });
    expect(canonical).toEqual({ bold: 'true' });
    expect(Object.keys(canonical)).toEqual(['bold']);
  });
});

describe('attrsEqual', () => {
  it('is true for the same set in a different insertion order', () => {
    expect(
      attrsEqual(
        { bold: 'true', italic: 'true' },
        { italic: 'true', bold: 'true' },
      ),
    ).toBe(true);
  });

  it('is false when one key differs', () => {
    expect(attrsEqual({ textColor: 'red' }, { textColor: 'blue' })).toBe(false);
    expect(attrsEqual({ bold: 'true' }, {})).toBe(false);
  });
});

describe('attrDelta', () => {
  it('names a key to add and nulls a key to remove', () => {
    expect(attrDelta({ bold: 'true' }, { italic: 'true' })).toEqual({
      bold: null,
      italic: 'true',
    });
  });

  it('is empty when the two sets agree', () => {
    expect(attrDelta({ bold: 'true' }, { bold: 'true' })).toEqual({});
  });

  it('names a changed value without nulling it first', () => {
    expect(attrDelta({ textColor: 'red' }, { textColor: 'blue' })).toEqual({
      textColor: 'blue',
    });
  });
});
