import React from 'react';
import styled from 'styled-components';
import type { BoardView } from '../generated/BoardClient';
import { tokens as t } from '../theme';

interface Props {
  board: BoardView;
  onOpen: () => void;
}

export default function BoardTile({ board, onOpen }: Props): React.ReactElement {
  return (
    <Tile data-testid="item-board" data-board-id={board.id} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <span className="name">{board.name || 'Untitled board'}</span>
      {board.archived && <span className="tag">archived</span>}
    </Tile>
  );
}

const Tile = styled.div`
  min-height: 92px; padding: 14px; border-radius: 10px; cursor: pointer;
  background: ${t.color.panel}; border: 1px solid ${t.color.border};
  display: flex; flex-direction: column; justify-content: space-between;
  &:hover { border-color: ${t.color.accent}; }
  .name { font-size: 14px; font-weight: 600; }
  .tag { font-size: 11px; color: ${t.color.text3}; }
`;
