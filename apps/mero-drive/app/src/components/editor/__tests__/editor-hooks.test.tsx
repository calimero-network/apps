// The attributes the browser suites address the editor through. They are a
// contract with those suites, so a rename has to break a test here first.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef, type MutableRefObject } from 'react';
import { EditorHeader, type TitleBinding } from '../EditorHeader';
import { stampBlocks } from '../EditorShell';

function Header(props: { undo?: boolean; readOnly?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const title: TitleBinding = {
    value: 'Notes',
    onChange: vi.fn(),
    onSelect: vi.fn(),
    inputRef: inputRef as MutableRefObject<HTMLInputElement | null>,
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
