import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import {
  appPath,
  copyLink,
  docUrl,
  parseAppPath,
  readReturnTo,
  saveReturnTo,
  type AppRoute,
} from '../routes';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function parse(url: string): AppRoute | null {
  const u = new URL(url, 'http://x');
  return parseAppPath(u.pathname, u.hash);
}

afterEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('appPath and parseAppPath', () => {
  const shapes: AppRoute[] = [
    { ws: 'ws1' },
    { ws: 'ws1', settings: true },
    { ws: 'ws1', folder: 'f1' },
    { ws: 'ws1', folder: 'f1', doc: 'doc-3' },
    { ws: 'ws1', folder: 'f1', doc: 'doc-3', block: 'blk-9' },
    // Ids are opaque, so reserved characters must survive as one segment.
    { ws: 'a/b', folder: 'c d', doc: 'e#f?g', block: 'h&i=j' },
  ];

  for (const route of shapes) {
    it(`round-trips ${JSON.stringify(route)}`, () => {
      const path = appPath(route);
      expect(path.startsWith('/app/')).toBe(true);
      expect(parse(path)).toEqual(route);
    });
  }

  it('writes the documented shapes', () => {
    expect(appPath({ ws: 'w' })).toBe('/app/w');
    expect(appPath({ ws: 'w', settings: true })).toBe('/app/w/settings');
    expect(appPath({ ws: 'w', folder: 'f' })).toBe('/app/w/f/f');
    expect(appPath({ ws: 'w', folder: 'f', doc: 'd' })).toBe('/app/w/f/f/d/d');
    expect(appPath({ ws: 'w', folder: 'f', doc: 'd', block: 'b' })).toBe(
      '/app/w/f/f/d/d#b=b',
    );
  });

  it('drops a block that has no doc to live in', () => {
    expect(appPath({ ws: 'w', folder: 'f', block: 'b' })).toBe('/app/w/f/f');
  });

  it('is null outside /app/<ws>', () => {
    expect(parse('/')).toBeNull();
    expect(parse('/app')).toBeNull();
    expect(parse('/app/')).toBeNull();
    expect(parse('/apps/w')).toBeNull();
    expect(parse('/join')).toBeNull();
  });

  it('is null when the workspace segment is not valid percent-encoding', () => {
    expect(parse('/app/%E0%A4%A')).toBeNull();
  });

  it('treats a truncated or unknown path as the workspace Home', () => {
    expect(parse('/app/w/f')).toEqual({ ws: 'w' });
    expect(parse('/app/w/nope')).toEqual({ ws: 'w' });
    expect(parse('/app/w/f/%E0%A4%A')).toEqual({ ws: 'w' });
  });

  it('keeps the folder when the doc part is truncated or malformed', () => {
    expect(parse('/app/w/f/f1/d')).toEqual({ ws: 'w', folder: 'f1' });
    expect(parse('/app/w/f/f1/x/doc-1')).toEqual({ ws: 'w', folder: 'f1' });
    expect(parse('/app/w/f/f1/d/%E0%A4%A')).toEqual({ ws: 'w', folder: 'f1' });
  });

  it('tolerates a trailing or doubled slash', () => {
    expect(parse('/app/w/f/f1/')).toEqual({ ws: 'w', folder: 'f1' });
    expect(parse('/app//w//settings')).toEqual({ ws: 'w', settings: true });
  });

  it('reads the block only from a b= hash and only on a doc', () => {
    expect(parse('/app/w/f/f1/d/d1#b=')).toEqual({ ws: 'w', folder: 'f1', doc: 'd1' });
    expect(parse('/app/w/f/f1/d/d1#access_token=t')).toEqual({
      ws: 'w',
      folder: 'f1',
      doc: 'd1',
    });
    expect(parse('/app/w/f/f1#b=blk')).toEqual({ ws: 'w', folder: 'f1' });
  });
});

describe('docUrl', () => {
  it('is absolute on this origin and carries the block', () => {
    expect(docUrl('w', 'f', 'doc-1', 'b1')).toBe(
      `${window.location.origin}/app/w/f/f/d/doc-1#b=b1`,
    );
    expect(docUrl('w', 'f', 'doc-1')).toBe(
      `${window.location.origin}/app/w/f/f/d/doc-1`,
    );
  });
});

describe('returnTo', () => {
  it('gives back an app path with its search and hash', () => {
    saveReturnTo('/app/w/f/f1/d/d1?node=2#b=blk');
    expect(readReturnTo()).toBe('/app/w/f/f1/d/d1?node=2#b=blk');
  });

  it('is null when nothing was saved', () => {
    expect(readReturnTo()).toBeNull();
  });

  it('refuses anything outside the app', () => {
    for (const bad of ['//evil.example/app/w', 'https://evil.example/app/w', '/join?x', '/application']) {
      sessionStorage.setItem('mero-drive:returnTo', bad);
      expect(readReturnTo()).toBeNull();
    }
  });
});

describe('copyLink', () => {
  it('writes the URL and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await copyLink('http://x/app/w');
    expect(writeText).toHaveBeenCalledWith('http://x/app/w');
    expect(toast.success).toHaveBeenCalledWith('Link copied');
  });

  it('says so when the clipboard refuses', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await copyLink('http://x/app/w');
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy link");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
