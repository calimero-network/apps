import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useAppRoute } from '../useAppRoute';

function setup(initial: string) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => {
      const location = useLocation();
      return {
        app: useAppRoute(),
        navigate: useNavigate(),
        url: location.pathname + location.search + location.hash,
      };
    },
    { wrapper },
  );
}

describe('useAppRoute', () => {
  it('parses the current location', () => {
    const { result } = setup('/app/w/f/f1/d/doc-2#b=blk');
    expect(result.current.app.route).toEqual({
      ws: 'w',
      folder: 'f1',
      doc: 'doc-2',
      block: 'blk',
    });
  });

  it('is null off the workspace paths', () => {
    expect(setup('/app').result.current.app.route).toBeNull();
  });

  it('pushes one history entry per screen, so back returns to the last one', () => {
    const { result } = setup('/app/w');
    act(() => result.current.app.goFolder('f1'));
    expect(result.current.url).toBe('/app/w/f/f1');
    act(() => result.current.app.goDoc('f1', 'doc-1', { block: 'b1' }));
    expect(result.current.url).toBe('/app/w/f/f1/d/doc-1#b=b1');
    act(() => result.current.app.goSettings());
    expect(result.current.url).toBe('/app/w/settings');
    act(() => result.current.app.goHome());
    expect(result.current.url).toBe('/app/w');

    act(() => result.current.navigate(-1));
    expect(result.current.url).toBe('/app/w/settings');
    act(() => result.current.navigate(-1));
    expect(result.current.url).toBe('/app/w/f/f1/d/doc-1#b=b1');
  });

  it('replaces the entry when asked', () => {
    const { result } = setup('/app/w/f/f1');
    act(() => result.current.app.goDoc('f1', 'doc-1'));
    act(() => result.current.app.goDoc('f1', 'doc-2', { replace: true }));
    act(() => result.current.navigate(-1));
    expect(result.current.url).toBe('/app/w/f/f1');
  });

  it('replaces a doc with its folder when asked', () => {
    const { result } = setup('/app/w');
    act(() => result.current.app.goDoc('f1', 'doc-1'));
    act(() => result.current.app.goFolder('f1', { replace: true }));
    expect(result.current.url).toBe('/app/w/f/f1');
    act(() => result.current.navigate(-1));
    expect(result.current.url).toBe('/app/w');
  });

  it('keeps the dev node param and drops every other one', () => {
    const { result } = setup('/app/w?node=2&q=old');
    act(() => result.current.app.goFolder('f1'));
    expect(result.current.url).toBe('/app/w/f/f1?node=2');
    act(() => result.current.app.goHome('q=new'));
    expect(result.current.url).toBe('/app/w?q=new&node=2');
  });

  it('builds the URL of a screen for a new tab, keeping the dev node param', () => {
    const { result } = setup('/app/w?node=2&tag=x');
    expect(
      result.current.app.href({ ws: 'w', folder: 'f 1', doc: 'd', block: 'b' }),
    ).toBe('/app/w/f/f%201/d/d?node=2#b=b');
    expect(result.current.app.href({ ws: 'w' }, 'tag=q3')).toBe(
      '/app/w?tag=q3&node=2',
    );
    expect(setup('/app/w').result.current.app.href({ ws: 'w', folder: 'f' })).toBe(
      '/app/w/f/f',
    );
  });

  it('carries a folder list filter in its search', () => {
    const { result } = setup('/app/w?node=2');
    act(() => result.current.app.goFolder('f1', { search: 'tag=q3' }));
    expect(result.current.url).toBe('/app/w/f/f1?tag=q3&node=2');
  });

  it('switches workspace, or clears it back to /app', () => {
    const { result } = setup('/app/w/f/f1?node=1');
    act(() => result.current.app.goWorkspace('w2'));
    expect(result.current.url).toBe('/app/w2?node=1');
    act(() => result.current.app.goWorkspace(null, { replace: true }));
    expect(result.current.url).toBe('/app?node=1');
    act(() => result.current.navigate(-1));
    expect(result.current.url).toBe('/app/w/f/f1?node=1');
  });

  // Clicking the folder that is already open must not make back a no-op.
  it('does not stack a second entry for the screen already shown', () => {
    const { result } = setup('/app/w');
    act(() => result.current.app.goFolder('f1'));
    act(() => result.current.app.goFolder('f1'));
    act(() => result.current.navigate(-1));
    expect(result.current.url).toBe('/app/w');
  });
});
