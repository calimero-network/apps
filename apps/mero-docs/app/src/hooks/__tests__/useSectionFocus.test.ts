// Opening a document at a linked block, against a real DOM container. jsdom
// has no layout, so each block reports where it sits through a stub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import postcss, { type AtRule, type Rule } from 'postcss';
import { useSectionFocus, WASH_MS } from '../useSectionFocus';

// Read as text through the glob: a plain CSS import is empty under vitest.
const [css] = Object.values(
  import.meta.glob('../../index.css', { query: '?raw', import: 'default', eager: true }),
) as string[];

let container: HTMLElement;
const wash = vi.fn();
const sectionOf = (id: string) => (id === 'blk-2' ? 'Milestones' : 'Intro');

function block(id: string, top: number): HTMLElement {
  const el = document.createElement('div');
  el.dataset.blockId = id;
  el.getBoundingClientRect = () => ({ top }) as DOMRect;
  container.appendChild(el);
  return el;
}

interface Props {
  block?: string;
  navKey?: string;
  ready: boolean;
}

function mount(initial: Props) {
  const scrollRef = { current: container };
  return renderHook(
    (props: Props) =>
      useSectionFocus({ ...props, scrollRef, sectionOf, wash }),
    { initialProps: initial },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  wash.mockReset();
  container = document.createElement('div');
  container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  document.body.appendChild(container);
  block('blk-1', 100);
  block('blk-2', 700);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useSectionFocus', () => {
  it('waits for the document, then scrolls the block near the top, washes it and names it', () => {
    const view = mount({ block: 'blk-2', navKey: 'k1', ready: false });
    expect(container.scrollTop).toBe(0);
    expect(view.result.current.banner).toBeNull();

    view.rerender({ block: 'blk-2', navKey: 'k1', ready: true });

    expect(container.scrollTop).toBe(700 - 100 - 24);
    expect(wash).toHaveBeenLastCalledWith('blk-2');
    expect(view.result.current.banner).toEqual({ variant: 'opened', section: 'Milestones' });
  });

  it('ends the wash after the CSS animation runs', () => {
    mount({ block: 'blk-2', navKey: 'k1', ready: true });
    act(() => vi.advanceTimersByTime(WASH_MS - 1));
    expect(wash).toHaveBeenLastCalledWith('blk-2');
    act(() => vi.advanceTimersByTime(1));
    expect(wash).toHaveBeenLastCalledWith(null);
  });

  it('stays at the top and says so when the block is gone', () => {
    container.scrollTop = 300;
    const view = mount({ block: 'blk-gone', navKey: 'k1', ready: true });
    expect(container.scrollTop).toBe(0);
    expect(wash).not.toHaveBeenCalled();
    expect(view.result.current.banner).toEqual({ variant: 'missing' });
  });

  it('does nothing without a linked block', () => {
    const view = mount({ navKey: 'k1', ready: true });
    expect(wash).not.toHaveBeenCalled();
    expect(view.result.current.banner).toBeNull();
  });

  it('acts once per navigation: a peer edit or re-render does not pull the view back', () => {
    const view = mount({ block: 'blk-2', navKey: 'k1', ready: true });
    container.scrollTop = 40; // the reader scrolled away
    view.rerender({ block: 'blk-2', navKey: 'k1', ready: true });
    view.rerender({ block: 'blk-2', navKey: 'k1', ready: false });
    view.rerender({ block: 'blk-2', navKey: 'k1', ready: true });
    expect(container.scrollTop).toBe(40);
    expect(wash).toHaveBeenCalledTimes(1);
  });

  it('runs again for a new navigation, even to the same block', () => {
    const view = mount({ block: 'blk-2', navKey: 'k1', ready: true });
    container.scrollTop = 40;
    view.rerender({ block: 'blk-2', navKey: 'k2', ready: true });
    expect(container.scrollTop).toBe(40 + 700 - 100 - 24);
    expect(wash).toHaveBeenCalledTimes(2);
  });

  it('drops the banner once the reader navigates on within the doc', () => {
    const view = mount({ block: 'blk-2', navKey: 'k1', ready: true });
    view.rerender({ navKey: 'k2', ready: true });
    expect(view.result.current.banner).toBeNull();
  });

  it('goes to the top and dismisses on request', () => {
    const view = mount({ block: 'blk-2', navKey: 'k1', ready: true });
    act(() => view.result.current.goTop());
    expect(container.scrollTop).toBe(0);
    expect(view.result.current.banner).not.toBeNull();
    act(() => view.result.current.dismiss());
    expect(view.result.current.banner).toBeNull();
  });
});

describe('section wash styles', () => {
  const root = postcss.parse(css);
  const washRules = (inside: (rule: Rule) => boolean) => {
    const found: Rule[] = [];
    root.walkRules('.section-wash', (rule) => {
      if (inside(rule)) found.push(rule);
    });
    return found;
  };
  const reducedMotion = (rule: Rule) =>
    rule.parent?.type === 'atrule' &&
    (rule.parent as AtRule).name === 'media' &&
    (rule.parent as AtRule).params === '(prefers-reduced-motion: reduce)';
  const durationMs = (rule: Rule) => {
    let value = '';
    rule.walkDecls('animation', (decl) => {
      value = decl.value;
    });
    const seconds = value.split(/\s+/).find((part) => /^\d+(\.\d+)?s$/.test(part));
    return seconds ? parseFloat(seconds) * 1000 : NaN;
  };

  it('animates the wash for as long as the hook keeps it', () => {
    const [motion] = washRules((rule) => !reducedMotion(rule));
    expect(durationMs(motion)).toBe(WASH_MS);
  });

  it('swaps the wash for a static outline held as long under reduced motion', () => {
    const [still] = washRules(reducedMotion);
    expect(still).toBeDefined();
    let animation = '';
    still.walkDecls('animation', (decl) => {
      animation = decl.value;
    });
    expect(animation.split(/\s+/)[0]).toBe('section-wash-outline');
    expect(durationMs(still)).toBe(WASH_MS);
  });
});
