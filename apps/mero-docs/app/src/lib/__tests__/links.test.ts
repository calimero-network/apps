import { describe, expect, it } from 'vitest';
import { docHref, KNOWN_APP_ORIGINS, parseDocHref } from '../links';

const ORIGIN = 'http://localhost:5173';
// eslint-disable-next-line no-script-url -- a hostile href the parser must reject
const SCRIPT_HREF = 'javascript:alert(1)';

describe('parseDocHref (L-15)', () => {
  it('reads a relative doc path', () => {
    expect(parseDocHref('/app/w1/f/f1/d/d1', ORIGIN)).toEqual({
      ws: 'w1',
      folder: 'f1',
      doc: 'd1',
    });
  });

  it('reads a section link', () => {
    expect(parseDocHref('/app/w1/f/f1/d/d1#b=blk-9', ORIGIN)).toEqual({
      ws: 'w1',
      folder: 'f1',
      doc: 'd1',
      block: 'blk-9',
    });
  });

  it('accepts the current origin and the deployed app', () => {
    const target = { ws: 'w1', folder: 'f1', doc: 'd1' };
    expect(parseDocHref(`${ORIGIN}/app/w1/f/f1/d/d1`, ORIGIN)).toEqual(target);
    expect(
      parseDocHref(`${KNOWN_APP_ORIGINS[0]}/app/w1/f/f1/d/d1`, ORIGIN),
    ).toEqual(target);
    expect(KNOWN_APP_ORIGINS).toEqual(['https://mero-docs.vercel.app']);
  });

  it('keeps a link to another workspace, so its card can say so (L-22)', () => {
    expect(parseDocHref('/app/other/f/f1/d/d1', ORIGIN)?.ws).toBe('other');
  });

  it('decodes ids and ignores the query string', () => {
    expect(
      parseDocHref('/app/a%2Fb/f/c%20d/d/e%23f?node=http://n1#b=h%26i', ORIGIN),
    ).toEqual({ ws: 'a/b', folder: 'c d', doc: 'e#f', block: 'h&i' });
  });

  it('rejects other origins and schemes', () => {
    for (const href of [
      'https://evil.example/app/w1/f/f1/d/d1',
      'http://mero-docs.vercel.app/app/w1/f/f1/d/d1',
      '//evil.example/app/w1/f/f1/d/d1',
      'http://localhost:3000/app/w1/f/f1/d/d1',
      SCRIPT_HREF,
      'mailto:a@b.c',
    ]) {
      expect({ href, target: parseDocHref(href, ORIGIN) }).toEqual({
        href,
        target: null,
      });
    }
  });

  it('rejects paths that do not name a doc', () => {
    for (const href of [
      '/app',
      '/app/w1',
      '/app/w1/settings',
      '/app/w1/f/f1',
      '/app/w1/f/f1/d/',
      '/app/w1/f/f1/x/d1',
      '/docs/w1/f/f1/d/d1',
      '/app/w1/f/f1/d/%E0%A4%A',
      '',
    ]) {
      expect({ href, target: parseDocHref(href, ORIGIN) }).toEqual({
        href,
        target: null,
      });
    }
  });

  it('rejects input that is not a URL', () => {
    expect(parseDocHref('http://[::1', ORIGIN)).toBeNull();
    expect(parseDocHref('/app/w1/f/f1/d/d1', 'not an origin')).toBeNull();
  });
});

describe('docHref', () => {
  it('writes a relative path that parses back', () => {
    const t = { ws: 'a/b', folder: 'c d', doc: 'e#f', block: 'h&i' };
    expect(docHref(t).startsWith('/app/')).toBe(true);
    expect(parseDocHref(docHref(t), ORIGIN)).toEqual(t);
    expect(docHref({ ws: 'w', folder: 'f', doc: 'd' })).toBe('/app/w/f/f/d/d');
  });
});
