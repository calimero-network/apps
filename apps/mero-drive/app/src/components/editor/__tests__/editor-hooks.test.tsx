// The attributes the browser suites address the editor through. They are a
// contract with those suites, so a rename has to break a test here first.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { EditorHeader, type TitleBinding } from '../EditorHeader';
import type { TitleCaret } from '@/lib/rich/cursors';
import { stampBlocks } from '../EditorShell';

const CARET = {
  author: 'alice',
  name: 'Ada',
  colour: '#3b82f6',
  caret: 2,
  from: 2,
  to: 4,
};

function Header(props: {
  undo?: boolean;
  readOnly?: boolean;
  carets?: TitleCaret[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const title: TitleBinding = {
    value: 'Notes',
    onChange: vi.fn(),
    onSelect: vi.fn(),
    inputRef,
    carets: props.carets ?? [],
  };
  return (
    <EditorHeader
      documentName="Notes"
      title={props.readOnly ? undefined : title}
      onUndo={props.undo ? vi.fn() : undefined}
      onRedo={props.undo ? vi.fn() : undefined}
    />
  );
}

describe('EditorHeader test hooks', () => {
  it('exposes the title field, undo and redo when editing is allowed', () => {
    render(<Header undo />);
    expect(
      (screen.getByTestId('doc-title-input') as HTMLInputElement).value,
    ).toBe('Notes');
    expect(screen.getByTestId('doc-undo')).toBeTruthy();
    expect(screen.getByTestId('doc-redo')).toBeTruthy();
  });

  it('renders the title read-only with no field and no undo', () => {
    render(<Header readOnly />);
    expect(screen.queryByTestId('doc-title-input')).toBeNull();
    expect(screen.queryByTestId('doc-undo')).toBeNull();
    expect(screen.getByText('Notes')).toBeTruthy();
  });
});

describe('title presence markers', () => {
  it('draws a caret and a selection for a peer on the title', () => {
    render(<Header carets={[CARET]} />);
    expect(screen.getByTestId('presence-cursor').dataset.author).toBe('alice');
    expect(screen.getByTestId('presence-selection').dataset.author).toBe(
      'alice',
    );
  });

  it('draws no selection for a collapsed caret', () => {
    render(<Header carets={[{ ...CARET, from: 2, to: 2 }]} />);
    expect(screen.getByTestId('presence-cursor')).toBeTruthy();
    expect(screen.queryByTestId('presence-selection')).toBeNull();
  });

  it('draws nothing when no peer is on the title', () => {
    render(<Header />);
    expect(screen.queryByTestId('presence-cursor')).toBeNull();
  });
});

describe('stampBlocks', () => {
  it('addresses each rendered block by its backend id', () => {
    const { container } = render(
      <div>
        <div data-id="blk-1">one</div>
        <div data-id="blk-2">two</div>
      </div>,
    );
    stampBlocks(container);
    expect(
      screen.getAllByTestId('doc-block').map((el) => el.dataset.blockId),
    ).toEqual(['blk-1', 'blk-2']);
  });

  it('does nothing without a root and leaves an unidentified node alone', () => {
    expect(() => stampBlocks(null)).not.toThrow();
    const { container } = render(<div>no id</div>);
    stampBlocks(container);
    expect(screen.queryByTestId('doc-block')).toBeNull();
  });
});
