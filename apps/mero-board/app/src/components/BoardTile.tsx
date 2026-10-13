import React from 'react';
import styled from 'styled-components';
import type { BoardView } from '../generated/BoardClient';
import { tokens as t } from '../theme';
import BoardMenu from './BoardMenu';

interface Props {
  board: BoardView;
  onOpen: () => void;
  currentUser: string;
  onRename: (name: string) => Promise<unknown>;
  onArchive: (archived: boolean) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}

export default function BoardTile({ board, onOpen, currentUser, onRename, onArchive, onDelete }: Props): React.ReactElement {
  return (
    <Tile data-testid="item-board" data-board-id={board.id} data-archived={board.archived ? 'true' : undefined}
      onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}>
      <div className="top">
        <span className="name">{board.name || 'Untitled board'}</span>
        <BoardMenu board={board} testId="board-tile-menu" canDelete={board.created_by === currentUser}
          onRename={onRename} onArchive={onArchive} onDelete={onDelete} />
      </div>
      {board.archived && <span className="tag">archived</span>}
    </Tile>
  );
}

const Tile = styled.div`
  min-height: 92px; padding: 14px; border-radius: 10px; cursor: pointer;
  background: ${t.color.panel}; border: 1px solid ${t.color.border};
  display: flex; flex-direction: column; justify-content: space-between;
  &:hover { border-color: ${t.color.accent}; }
  &[data-archived='true'] .name { color: ${t.color.text2}; }
  .top { display: flex; align-items: flex-start; gap: 8px; }
  .name { font-size: 14px; font-weight: 600; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .tag { font-size: 11px; color: ${t.color.text3}; }
`;
