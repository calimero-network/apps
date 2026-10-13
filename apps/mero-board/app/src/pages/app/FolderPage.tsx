import React, { useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { tokens as t } from '../../theme';
import { APP_ROUTE } from '../../config';
import { useBoards } from '../../hooks/useBoards';
import BoardTile from '../../components/BoardTile';
import InlineForm from '../../components/InlineForm';
import { useAppCtx } from './appContext';

/** The active folder: its boards in a grid, plus create and the archived toggle. */
export default function FolderPage(): React.ReactElement {
  const { ws } = useAppCtx();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const data = useBoards({ contextId: ws.contextId, executorPublicKey: ws.executorPublicKey }, showArchived);

  return (
    <Wrap data-testid="folder-page">
      <header>
        <h1>{ws.folders.find((f) => f.contextId === ws.activeFolder)?.name ?? 'Folder'}</h1>
        <label className="toggle">
          <input type="checkbox" data-testid="toggle-archived" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </header>
      {data.warmingUp && <p className="muted" data-testid="folder-syncing">Syncing this folder…</p>}
      <Grid>
        {data.boards.map((b) => (
          <BoardTile key={b.id} board={b} onOpen={() => navigate(`${APP_ROUTE}/b/${b.id}`)} />
        ))}
        {creating ? (
          <div className="new">
            <InlineForm
              placeholder="Board name"
              submitLabel="Create board"
              testId="board-create"
              onSubmit={async (name) => { const id = await data.createBoard(name); if (!id) throw new Error('This folder is not ready yet; try again in a moment.'); setCreating(false); navigate(`${APP_ROUTE}/b/${id}`); }}
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : (
          <button className="new add" data-testid="board-create-btn" onClick={() => setCreating(true)} disabled={!data.ready}>+ New board</button>
        )}
      </Grid>
      {!data.boards.length && !creating && !data.warmingUp && (
        <p className="muted" data-testid="folder-empty">No boards yet. Create one to start.</p>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  padding: 20px 24px 40px; flex: 1; overflow: auto;
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.02em; }
  .toggle { font-size: 12.5px; color: ${t.color.text2}; display: flex; gap: 6px; align-items: center; }
  .muted { font-size: 13px; color: ${t.color.text3}; }
`;
const Grid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;
  .new { min-height: 92px; border-radius: 10px; border: 1px dashed ${t.color.border}; padding: 14px; background: transparent; }
  .add { color: ${t.color.text2}; font-size: 13.5px; cursor: pointer; text-align: left; }
  .add:hover { border-color: ${t.color.accent}; color: ${t.color.text}; }
`;
