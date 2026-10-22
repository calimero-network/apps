import React, { useState } from 'react';
import styled from 'styled-components';
import type { BoardView } from '../generated/BoardClient';
import { tokens as t } from '../theme';
import InlineForm from './InlineForm';
import { describeError } from '../utils/errors';

interface Props {
  board: BoardView;
  /** `board-menu` on the board page, `board-tile-menu` on a folder tile. */
  testId: string;
  /** Delete is offered only to the board's creator. */
  canDelete: boolean;
  onRename: (name: string) => Promise<unknown>;
  onArchive: (archived: boolean) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}

/**
 * Rename, archive / unarchive and (creator only) delete a board. Clicks and
 * keys stay inside the menu so a tile around it does not open the board.
 */
export default function BoardMenu({ board, testId, canDelete, onRename, onArchive, onDelete }: Props): React.ReactElement {
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (p: () => Promise<unknown>) => { setError(null); p().catch((e) => setError(describeError(e))); };

  return (
    <Menu data-testid={testId} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <summary aria-label="Board actions">…</summary>
      <div className="items">
        {renaming ? (
          <InlineForm initial={board.name} placeholder="Board name" submitLabel="Save" testId="board-rename"
            onSubmit={async (n) => { await onRename(n); setRenaming(false); }} onCancel={() => setRenaming(false)} />
        ) : (
          <button type="button" data-testid="board-rename" onClick={() => setRenaming(true)}>Rename</button>
        )}
        <button type="button" data-testid="board-archive" onClick={() => act(() => onArchive(!board.archived))}>
          {board.archived ? 'Unarchive board' : 'Archive board'}
        </button>
        {canDelete && !confirmDelete && (
          <button type="button" className="danger" data-testid="board-delete" onClick={() => setConfirmDelete(true)}>Delete board</button>
        )}
        {canDelete && confirmDelete && (
          <>
            <span className="muted">Delete this board for everyone?</span>
            <button type="button" className="danger" data-testid="confirm-delete_board" onClick={() => act(onDelete)}>Delete</button>
            <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </>
        )}
        {error && <p className="err" data-testid="board-menu-error">{error}</p>}
      </div>
    </Menu>
  );
}

const Menu = styled.details`
  position: relative;
  summary { list-style: none; cursor: pointer; color: ${t.color.text3}; padding: 0 6px; font-size: 15px; }
  summary::-webkit-details-marker { display: none; }
  .items {
    position: absolute; z-index: 20; top: 100%; right: 0; min-width: 220px; margin-top: 4px; padding: 6px;
    display: flex; flex-direction: column; gap: 4px; cursor: default;
    background: ${t.color.panel}; border: 1px solid ${t.color.border}; border-radius: 8px;
  }
  .items > button {
    width: 100%; text-align: left; background: transparent; border: 0; color: ${t.color.text};
    padding: 6px 8px; font-size: 12.5px; cursor: pointer; border-radius: 6px;
  }
  .items > button:hover { background: ${t.color.raised}; }
  .items > .danger { color: ${t.color.danger}; }
  .muted { font-size: 12px; color: ${t.color.text3}; padding: 2px 8px; }
  .err { margin: 0; font-size: 12px; color: ${t.color.danger}; padding: 2px 8px; }
`;
