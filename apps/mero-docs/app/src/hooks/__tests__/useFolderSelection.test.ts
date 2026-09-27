import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFolderSelection } from '../useFolderSelection';
import type { RegistryFolderShape } from '../useWorkspaceTree';

const folder = (id: string): RegistryFolderShape => ({
  id,
  parent_id: null,
  color: null,
});
const NONE = new Set<string>();

type Props = {
  selected: string | null;
  reg: RegistryFolderShape[] | null;
  hidden: Set<string>;
};

function setup(initialProps: Props) {
  const onGone = vi.fn();
  const view = renderHook(
    ({ selected, reg, hidden }: Props) =>
      useFolderSelection(selected, reg, hidden, onGone),
    { initialProps },
  );
  return { ...view, onGone };
}

describe('useFolderSelection', () => {
  it('drops the folder once it is hidden from the caller', () => {
    const reg = [folder('a'), folder('b')];
    const { rerender, onGone } = setup({ selected: 'a', reg, hidden: NONE });
    expect(onGone).not.toHaveBeenCalled();
    rerender({ selected: 'a', reg, hidden: new Set(['a']) });
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('drops the folder once it is deleted', () => {
    const { rerender, onGone } = setup({
      selected: 'a',
      reg: [folder('a'), folder('b')],
      hidden: NONE,
    });
    rerender({ selected: 'a', reg: [folder('b')], hidden: NONE });
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('keeps the folder while it is still listed and visible', () => {
    const { rerender, onGone } = setup({
      selected: 'a',
      reg: [folder('a')],
      hidden: NONE,
    });
    rerender({ selected: 'a', reg: [folder('a'), folder('b')], hidden: new Set(['b']) });
    expect(onGone).not.toHaveBeenCalled();
  });

  // A reload on a folder URL renders before the folder list arrives.
  it('waits for the folder list before judging a folder from the URL', () => {
    const { rerender, onGone } = setup({ selected: 'a', reg: null, hidden: NONE });
    expect(onGone).not.toHaveBeenCalled();
    rerender({ selected: 'a', reg: [folder('a')], hidden: NONE });
    expect(onGone).not.toHaveBeenCalled();
  });

  it('does nothing with no folder selected', () => {
    const { onGone } = setup({ selected: null, reg: [], hidden: NONE });
    expect(onGone).not.toHaveBeenCalled();
  });
});
