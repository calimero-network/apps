/**
 * AppPage — the full spreadsheet workspace.
 *
 * Layout (full viewport):
 *   ┌──────────────────────── Toolbar ────────────────────────────┐
 *   ├─────────────────────── FormulaBar ──────────────────────────┤
 *   │                                                             │
 *   │                    SpreadsheetGrid                          │
 *   │                                                             │
 *   └──────────────────────── SheetTabs ──────────────────────────┘
 *
 * FunctionHelpPanel slides in from the right as an overlay.
 *
 * Three states:
 *  1. Loading — null render (wait for auth probe)
 *  2. Welcome gate (!ws.ready && !ws.loading) — create or join
 *  3. Workspace ready — full spreadsheet UI
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { C } from '../../theme';
import { APP_DISPLAY_NAME } from '../../config';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useSpreadsheet } from '../../hooks/useSpreadsheet';
import { describeError } from '../../utils/errors';
import { cellRef } from '../../components/FormulaBar';
import FormulaBar from '../../components/FormulaBar';
import SpreadsheetGrid from '../../components/SpreadsheetGrid';
import SheetTabs from '../../components/SheetTabs';
import FunctionHelpPanel from '../../components/FunctionHelpPanel';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';

const COLS = 26;
const ROWS = 50;

export default function AppPage() {
  const { logout } = useMero();
  const ws = useWorkspace();
  const ss = useSpreadsheet({
    contextId: ws.contextId,
    executorPublicKey: ws.executorPublicKey,
  });

  // ── Workspace modals ────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  // ── Project bootstrap flow ──────────────────────────────────────
  const [projectName, setProjectName] = useState('Untitled Spreadsheet');

  // After bootstrap completes, initProject must be called with the project name.
  // We store the pending name here; a useEffect fires it once ws.ready transitions
  // to true (the client is available by then, so ss.initProject works).
  const [pendingInitName, setPendingInitName] = useState<string | null>(null);
  const wasReadyRef = useRef(false);
  const initProjectRef = useRef(ss.initProject);
  useEffect(() => { initProjectRef.current = ss.initProject; });
  useEffect(() => {
    if (ws.ready && !wasReadyRef.current && pendingInitName) {
      wasReadyRef.current = true;
      const name = pendingInitName;
      setPendingInitName(null);
      void initProjectRef.current(name);
    } else if (ws.ready) {
      wasReadyRef.current = true;
    }
  }, [ws.ready, pendingInitName]);

  // ── Spreadsheet state ───────────────────────────────────────────
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [formulaInput, setFormulaInput] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const formulaInputRef = useRef<HTMLInputElement>(null);

  // Point mode: active while editing a formula (a dirty cell whose value starts
  // with `=`). In this mode clicking/dragging cells inserts their reference into
  // the formula instead of moving the selection — standard spreadsheet flow.
  const isEditingFormula = isDirty && formulaInput.trimStart().startsWith('=');

  // Auto-select the first sheet when sheets load / change
  useEffect(() => {
    if (ss.sheets.length > 0) {
      const stillExists = ss.sheets.find((s) => s.id === activeSheetId);
      if (!stillExists) setActiveSheetId(ss.sheets[0].id);
    }
  }, [ss.sheets, activeSheetId]);

  // Safety net: guarantee an editable sheet exists. The formula bar is disabled
  // without an active sheet, so a workspace with zero sheets opens read-only —
  // you can't type in any cell. `initProject` creates a default sheet for the
  // creator, but a context can become ready without that path (e.g. an
  // auto-created / externally-provisioned context), leaving it sheetless. When
  // the workspace is ready, finished its initial load, and is genuinely empty
  // (no sheets AND no cells — so we don't race a joiner mid-sync into creating
  // a duplicate), create one default sheet, once per session.
  const ensuredDefaultSheetRef = useRef(false);
  useEffect(() => {
    if (
      ss.ready &&
      ss.loaded && // the first fetch has resolved — empty is authoritative, not "not-yet-loaded"
      ss.sheets.length === 0 &&
      ss.cells.length === 0 &&
      !ensuredDefaultSheetRef.current
    ) {
      ensuredDefaultSheetRef.current = true;
      void ss.createSheet('Sheet 1');
    }
  }, [ss.ready, ss.loaded, ss.sheets.length, ss.cells.length, ss]);

  // Sync formula bar when selected cell or cells data changes
  const prevCellRef = useRef<string | null>(null);
  useEffect(() => {
    const key = selectedCell ? `${activeSheetId}:${selectedCell.row}-${selectedCell.col}` : null;
    if (key === prevCellRef.current) return;
    prevCellRef.current = key;

    if (!selectedCell || !activeSheetId) {
      setFormulaInput('');
      setIsDirty(false);
      return;
    }
    const cell = ss.cells.find(
      (c) =>
        c.sheet_id === activeSheetId &&
        c.row === selectedCell.row &&
        c.col === selectedCell.col,
    );
    setFormulaInput(cell?.raw_value ?? '');
    setIsDirty(false);
  }, [selectedCell, activeSheetId]); // intentionally omit ss.cells so typing doesn't reset

  // ── Commit current cell ─────────────────────────────────────────
  const commitCellRef = useRef<(() => Promise<void>) | null>(null);
  const commitCell = useCallback(async () => {
    if (!selectedCell || !activeSheetId || !isDirty) return;
    const value = formulaInput;
    if (!value.trim()) {
      await ss.clearCell(activeSheetId, selectedCell.row, selectedCell.col);
    } else {
      await ss.setCell(activeSheetId, selectedCell.row, selectedCell.col, value);
    }
    setIsDirty(false);
  }, [selectedCell, activeSheetId, isDirty, formulaInput, ss]);

  // Keep ref current so SpreadsheetGrid can call it
  commitCellRef.current = commitCell;

  // ── Cell selection ──────────────────────────────────────────────
  const handleSelectCell = useCallback(
    async (row: number, col: number) => {
      // Commit dirty cell before moving
      if (isDirty && selectedCell && activeSheetId) {
        await commitCellRef.current?.();
      }
      setSelectedCell({ row, col });
      if (activeSheetId) {
        void ss.updateCursor(activeSheetId, row, col);
      }
    },
    [isDirty, selectedCell, activeSheetId, ss],
  );

  // Commit + move (Enter = down, Tab = right)
  const handleCommitAndMove = useCallback(
    async (direction: 'down' | 'right' | 'none') => {
      await commitCellRef.current?.();
      if (!selectedCell) return;
      const { row, col } = selectedCell;
      if (direction === 'down' && row < ROWS - 1) setSelectedCell({ row: row + 1, col });
      else if (direction === 'right' && col < COLS - 1) setSelectedCell({ row, col: col + 1 });
    },
    [selectedCell],
  );

  // ── Formula bar ─────────────────────────────────────────────────
  const handleFormulaChange = useCallback((v: string) => {
    setFormulaInput(v);
    setIsDirty(true);
  }, []);

  const handleFormulaCommit = useCallback(async () => {
    await commitCellRef.current?.();
    // Move down after commit via formula bar Enter
    setSelectedCell((prev) =>
      prev && prev.row < ROWS - 1 ? { row: prev.row + 1, col: prev.col } : prev,
    );
  }, []);

  const handleFormulaCancel = useCallback(() => {
    // Revert to stored value
    if (!selectedCell || !activeSheetId) return;
    const cell = ss.cells.find(
      (c) =>
        c.sheet_id === activeSheetId &&
        c.row === selectedCell.row &&
        c.col === selectedCell.col,
    );
    setFormulaInput(cell?.raw_value ?? '');
    setIsDirty(false);
  }, [selectedCell, activeSheetId, ss.cells]);

  // Insert a cell/range reference into the formula at the caret (point mode).
  const insertRef = useCallback(
    (ref: string) => {
      const el = formulaInputRef.current;
      const cur = formulaInput;
      const start = el?.selectionStart ?? cur.length;
      const end = el?.selectionEnd ?? start;
      const next = cur.slice(0, start) + ref + cur.slice(end);
      setFormulaInput(next);
      setIsDirty(true);
      // Restore focus and place the caret just after the inserted reference so
      // the user can keep typing (e.g. an operator, or `)`).
      requestAnimationFrame(() => {
        const e2 = formulaInputRef.current;
        if (e2) {
          e2.focus();
          const pos = start + ref.length;
          e2.setSelectionRange(pos, pos);
        }
      });
    },
    [formulaInput],
  );

  // ── Sheet management ────────────────────────────────────────────
  const handleAddSheet = useCallback(async () => {
    const name = `Sheet ${ss.sheets.length + 1}`;
    await ss.createSheet(name);
  }, [ss]);

  const handleSelectSheet = useCallback(
    async (id: string) => {
      if (isDirty) await commitCellRef.current?.();
      setActiveSheetId(id);
      setSelectedCell(null);
      setFormulaInput('');
      setIsDirty(false);
    },
    [isDirty],
  );

  // ── Download ────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    const lines: string[] = [];
    for (const sheet of ss.sheets) {
      lines.push(`# ${sheet.name}`);
      const sheetCells = ss.cells.filter((c) => c.sheet_id === sheet.id);
      if (sheetCells.length > 0) {
        const maxRow = sheetCells.reduce((m, c) => Math.max(m, c.row), 0);
        const maxCol = sheetCells.reduce((m, c) => Math.max(m, c.col), 0);
        for (let r = 0; r <= maxRow; r++) {
          const rowData: string[] = [];
          for (let c = 0; c <= maxCol; c++) {
            const cell = sheetCells.find((x) => x.row === r && x.col === c);
            const val = cell ? cell.computed_value.replace(/"/g, '""') : '';
            rowData.push(`"${val}"`);
          }
          lines.push(rowData.join(','));
        }
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_DISPLAY_NAME.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [ss.sheets, ss.cells]);

  // ════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════

  // 1. Loading
  if (ws.loading) return null;

  // 2. Welcome gate
  if (!ws.ready) {
    return (
      <FullCenter>
        <WelcomeCard>
          <WelcomeIcon aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </WelcomeIcon>
          <h2>Welcome to {APP_DISPLAY_NAME}</h2>
          <p>
            Create a peer-to-peer spreadsheet workspace, or join one you&rsquo;ve been
            invited to. All data lives on your node — no central server.
          </p>

          <label htmlFor="project-name" style={{ display: 'block', textAlign: 'left', marginBottom: 6, fontSize: 13, fontWeight: 600, color: C.muted }}>
            Project name
          </label>
          <ProjectNameInput
            id="project-name"
            data-testid="field-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Q3 Budget, Team OKRs…"
          />

          <ButtonRow>
            <PrimaryBtn
              data-testid="action-init_project"
              disabled={!projectName.trim()}
              onClick={() => {
                setPendingInitName(projectName.trim());
                void ws.bootstrap();
              }}
            >
              Create workspace
            </PrimaryBtn>
            <SecondaryBtn onClick={() => setShowJoin(true)}>
              Join with invitation
            </SecondaryBtn>
          </ButtonRow>

          {ws.error && <ErrLine>{describeError(ws.error)}</ErrLine>}
        </WelcomeCard>

        {showJoin && (
          <JoinModal
            onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
            onClose={() => setShowJoin(false)}
          />
        )}
      </FullCenter>
    );
  }

  // 3. Full spreadsheet view
  const selRef = selectedCell ? cellRef(selectedCell.row, selectedCell.col) : null;

  return (
    <AppShell>
      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <Toolbar>
        <Brand>
          <GridIcon aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
            </svg>
          </GridIcon>
          <AppName>{APP_DISPLAY_NAME}</AppName>
        </Brand>

        <ToolbarActions>
          <ToolBtn
            data-testid="action-export_all"
            onClick={handleDownload}
            title="Download as CSV"
            aria-label="Download spreadsheet as CSV"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Download</span>
          </ToolBtn>

          <ToolBtn
            onClick={() => setShowHelp(true)}
            title="Function reference"
            aria-label="Open function reference"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Functions</span>
          </ToolBtn>

          <Divider />

          <ToolBtn onClick={() => setShowInvite(true)} aria-label="Invite collaborators">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            <span>Invite</span>
          </ToolBtn>

          <ToolBtn onClick={() => setShowJoin(true)} aria-label="Join workspace">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            <span>Join</span>
          </ToolBtn>

          <SignOutBtn onClick={logout} aria-label="Sign out">
            Sign out
          </SignOutBtn>
        </ToolbarActions>
      </Toolbar>

      {/* ── Formula bar ──────────────────────────────────────────── */}
      <FormulaBar
        selectedCell={selectedCell}
        value={formulaInput}
        onChange={handleFormulaChange}
        onCommit={handleFormulaCommit}
        onCancel={handleFormulaCancel}
        functions={ss.functions}
        disabled={!activeSheetId}
        inputRef={formulaInputRef}
      />

      {/* Commit button next to formula bar (accessible test target) */}
      {isDirty && selectedCell && (
        <CommitBar>
          <CommitBtn
            data-testid="action-set_cell"
            onClick={handleFormulaCommit}
            aria-label={`Commit value to cell ${selRef ?? ''}`}
            title="Confirm (Enter)"
          >
            ✓
          </CommitBtn>
          <CancelCommitBtn
            data-testid="action-clear_cell"
            onClick={handleFormulaCancel}
            aria-label="Cancel edit"
            title="Cancel (Escape)"
          >
            ✗
          </CancelCommitBtn>
        </CommitBar>
      )}

      {/* ── Spreadsheet grid ─────────────────────────────────────── */}
      <SpreadsheetGrid
        sheetId={activeSheetId}
        cells={ss.cells}
        cursors={ss.cursors}
        selectedCell={selectedCell}
        editingValue={isDirty ? formulaInput : null}
        pointMode={isEditingFormula}
        onPointRef={insertRef}
        onSelectCell={handleSelectCell}
        onCommitAndMove={handleCommitAndMove}
      />

      {/* ── Sheet tabs ───────────────────────────────────────────── */}
      <SheetTabs
        sheets={ss.sheets}
        activeSheetId={activeSheetId}
        onSelect={handleSelectSheet}
        onAdd={handleAddSheet}
        onRename={ss.renameSheet}
        onDelete={ss.deleteSheet}
      />

      {/* ── Overlays ─────────────────────────────────────────────── */}
      {showHelp && (
        <FunctionHelpPanel
          functions={ss.functions}
          onClose={() => setShowHelp(false)}
        />
      )}
      {showInvite && (
        <InviteModal
          onInvite={ws.invite}
          onClose={() => setShowInvite(false)}
        />
      )}
      {showJoin && (
        <JoinModal
          onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
          onClose={() => setShowJoin(false)}
        />
      )}
    </AppShell>
  );
}

// ── Styled components ────────────────────────────────────────────────────────

const AppShell = styled.div`
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: ${C.paper};
  color: ${C.ink};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
`;

const Toolbar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 12px 0 14px;
  background: ${C.paper};
  border-bottom: 1px solid ${C.line};
  flex-shrink: 0;
  gap: 12px;
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const GridIcon = styled.div`
  display: flex;
  align-items: center;
  color: ${C.green};
`;

const AppName = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: ${C.ink};
  letter-spacing: -0.2px;
  white-space: nowrap;
`;

const ToolbarActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const ToolBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 12.5px;
  font-weight: 500;
  color: ${C.muted};
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s, color 0.14s;

  svg { flex-shrink: 0; }

  &:hover {
    background: ${C.paper2};
    color: ${C.ink};
  }

  @media (max-width: 700px) { span { display: none; } }
`;

const Divider = styled.div`
  width: 1px;
  height: 20px;
  background: ${C.line};
  margin: 0 4px;
  flex-shrink: 0;
`;

const SignOutBtn = styled.button`
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 500;
  color: ${C.muted};
  background: transparent;
  border: 1px solid ${C.line};
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s, color 0.14s;
  margin-left: 4px;

  &:hover {
    background: ${C.paper2};
    color: ${C.ink};
  }
`;

/* Inline commit/cancel buttons shown in formula bar area when cell is dirty */
const CommitBar = styled.div`
  display: flex;
  align-items: center;
  position: absolute;
  right: 12px;
  /* vertically aligned with formula bar (48px toolbar + formula bar starts) */
  top: 48px;
  z-index: 20;
  gap: 2px;
`;

const CommitBtn = styled.button`
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: ${C.greenDeep};
  background: rgba(164, 255, 17, 0.15);
  border: 1px solid rgba(164, 255, 17, 0.4);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.14s;

  &:hover { background: rgba(164, 255, 17, 0.3); }
`;

const CancelCommitBtn = styled.button`
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: ${C.danger};
  background: transparent;
  border: 1px solid ${C.line};
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.14s;

  &:hover { background: rgba(220, 38, 38, 0.08); }
`;

// ── Welcome gate ─────────────────────────────────────────────────

const FullCenter = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: ${C.paper};
`;

const WelcomeCard = styled.div`
  max-width: 460px;
  width: 100%;
  padding: 36px 32px;
  background: ${C.paper2};
  border: 1px solid ${C.line};
  border-radius: 20px;
  text-align: center;

  h2 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: ${C.ink};
    margin: 0 0 10px;
  }
  p {
    font-size: 14px;
    color: ${C.muted};
    margin: 0 0 24px;
    line-height: 1.6;
  }
`;

const WelcomeIcon = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 16px;
  background: rgba(164, 255, 17, 0.14);
  border: 1px solid rgba(164, 255, 17, 0.4);
  display: grid;
  place-items: center;
  margin: 0 auto 20px;
  color: ${C.greenDeep};
`;

const ProjectNameInput = styled.input`
  width: 100%;
  padding: 11px 14px;
  font-size: 14px;
  color: ${C.ink};
  background: ${C.paper};
  border: 1px solid ${C.line};
  border-radius: 10px;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 20px;
  transition: border-color 0.15s, box-shadow 0.15s;

  &::placeholder { color: ${C.mutedSoft}; }
  &:focus {
    border-color: ${C.green};
    box-shadow: 0 0 0 3px rgba(164, 255, 17, 0.18);
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
`;

const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 11px 20px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  color: ${C.onAccent};
  background: ${C.green};
  border: 1px solid #93e60c;
  transition: background 0.18s, transform 0.15s;

  &:hover:not(:disabled) {
    background: ${C.greenHover};
    transform: translateY(-1px);
  }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const SecondaryBtn = styled.button`
  padding: 11px 18px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  color: ${C.ink};
  background: ${C.paper};
  border: 1px solid ${C.line};
  transition: background 0.15s, border-color 0.15s;

  &:hover { background: ${C.paper2}; border-color: ${C.green}; }
`;

const ErrLine = styled.p`
  margin: 12px 0 0;
  font-size: 13px;
  color: ${C.danger};
`;
