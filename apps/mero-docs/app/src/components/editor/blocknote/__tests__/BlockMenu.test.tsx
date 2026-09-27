// The block menu's own item against stand-ins for BlockNote's menu parts, so
// each assertion is the label a user sees or the section a copy names.
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BlockSideMenu, SectionLinksContext, sectionName } from '../BlockMenu';

let sideMenuBlock: unknown;

vi.mock('@blocknote/core/extensions', () => ({ SideMenuExtension: {} }));
vi.mock('@blocknote/react', () => ({
  useComponentsContext: () => ({
    Generic: {
      Menu: {
        Item: (props: {
          children: ReactNode;
          icon?: ReactNode;
          onClick?: () => void;
          disabled?: boolean;
        }) => (
          <button role="menuitem" disabled={props.disabled} onClick={props.onClick}>
            {props.icon}
            {props.children}
          </button>
        ),
      },
    },
  }),
  useExtensionState: (
    _extension: unknown,
    { selector }: { selector: (state: { block: unknown }) => unknown },
  ) => selector({ block: sideMenuBlock }),
  useDictionary: () => ({
    drag_handle: { delete_menuitem: 'Delete', colors_menuitem: 'Colors' },
  }),
  SideMenu: ({ dragHandleMenu: Menu }: { dragHandleMenu: () => ReactNode }) => <Menu />,
  DragHandleMenu: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  RemoveBlockItem: ({ children }: { children: ReactNode }) => <button role="menuitem">{children}</button>,
  BlockColorsItem: ({ children }: { children: ReactNode }) => <button role="menuitem">{children}</button>,
}));

const block = (type: string, text: string) => ({
  id: 'blk-1',
  type,
  props: {},
  content: text ? [{ type: 'text', text, styles: {} }] : [],
  children: [],
});

const copy = vi.fn();

function renderMenu(confirmed = true) {
  const links = { copy, isConfirmed: () => confirmed };
  return render(
    <SectionLinksContext.Provider value={links}>
      <BlockSideMenu />
    </SectionLinksContext.Provider>,
  );
}

beforeEach(() => {
  copy.mockReset();
});

describe('BlockSideMenu', () => {
  it('offers Copy link to section first, then the default items', () => {
    sideMenuBlock = block('heading', 'Milestones');
    renderMenu();
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Copy link to section', 'Delete', 'Colors']);
  });

  it('names a heading by its text', () => {
    sideMenuBlock = block('heading', 'Milestones');
    renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link to section' }));
    expect(copy).toHaveBeenCalledWith('blk-1', 'Milestones');
  });

  it('names a paragraph by its first 40 characters', () => {
    sideMenuBlock = block('paragraph', 'Pricing follows the model in Pricing notes, and more');
    renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link to section' }));
    expect(copy).toHaveBeenCalledWith('blk-1', 'Pricing follows the model in Pricing not…');
  });

  it('names an empty block "this section"', () => {
    sideMenuBlock = block('paragraph', '');
    renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link to section' }));
    expect(copy).toHaveBeenCalledWith('blk-1', 'this section');
  });

  it('is disabled and says Saving… until the node has the block', () => {
    sideMenuBlock = block('heading', 'Milestones');
    const view = renderMenu(false);
    const pending = screen.getByRole('menuitem', { name: /Copy link to section/ });
    expect(pending.textContent).toBe('Copy link to sectionSaving…');
    expect((pending as HTMLButtonElement).disabled).toBe(true);

    view.unmount();
    renderMenu(true);
    const ready = screen.getByRole('menuitem', { name: 'Copy link to section' });
    expect((ready as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers no link without a document to link into', () => {
    sideMenuBlock = block('heading', 'Milestones');
    render(<BlockSideMenu />);
    expect(screen.queryByRole('menuitem', { name: /Copy link/ })).toBeNull();
  });
});

describe('sectionName', () => {
  it('cuts by character, never through an emoji', () => {
    const text = `${'a'.repeat(39)}🎉 tail`;
    expect(sectionName(block('paragraph', text))).toBe(`${'a'.repeat(39)}🎉…`);
  });
});
