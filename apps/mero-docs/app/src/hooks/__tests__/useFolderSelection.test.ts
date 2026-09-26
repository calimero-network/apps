import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFolderSelection } from '../useFolderSelection';
import type { RegistryFolderShape } from '../useWorkspaceTree';

const folder = (id: string): RegistryFolderShape => ({
  id,
  parent_id: null,
  color: null,
});
const NONE = new Set<string>();

function setup(registry: RegistryFolderShape[]) {
  return renderHook(
    ({ ns, reg, hidden }) => useFolderSelection(ns, reg, hidden),
    { initialProps: { ns: 'ns1', reg: registry, hidden: NONE } },
  );
}

describe('useFolderSelection', () => {
  it('clears the selection on a namespace switch', () => {
    const reg = [folder('a')];
    const { result, rerender } = setup(reg);
    act(() => result.current[1]('a'));
    rerender({ ns: 'ns2', reg, hidden: NONE });
    expect(result.current[0]).toBeNull();
  });

  it('clears the selection once the folder is hidden from the caller', () => {
    const reg = [folder('a'), folder('b')];
    const { result, rerender } = setup(reg);
    act(() => result.current[1]('a'));
    rerender({ ns: 'ns1', reg, hidden: new Set(['a']) });
    expect(result.current[0]).toBeNull();
  });

  it('clears the selection once the folder is deleted', () => {
    const { result, rerender } = setup([folder('a'), folder('b')]);
    act(() => result.current[1]('a'));
    rerender({ ns: 'ns1', reg: [folder('b')], hidden: NONE });
    expect(result.current[0]).toBeNull();
  });

  it('keeps the selection while the folder is still listed and visible', () => {
    const { result, rerender } = setup([folder('a')]);
    act(() => result.current[1]('a'));
    rerender({
      ns: 'ns1',
      reg: [folder('a'), folder('b')],
      hidden: new Set(['b']),
    });
    expect(result.current[0]).toBe('a');
  });
});
