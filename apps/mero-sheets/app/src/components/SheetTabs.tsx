/**
 * SheetTabs — tab bar at the bottom of the spreadsheet.
 *
 * Each tab:
 *  - Click → switch to that sheet
 *  - Double-click → rename inline
 *  - Hover × button → delete (disabled for the last sheet)
 *
 * "+" button adds a new sheet; the lock button adds a private one, which
 * lives only on this node (nobody else sees it) and shows a lock on its tab.
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { type Sheet } from '../hooks/useSpreadsheet';
import { describeError } from '../utils/errors';

interface SheetTabsProps {
  /** Shared sheets first, then this node's private ones. */
  sheets: Sheet[];
  /** Which of `sheets` are private. */
  privateIds: ReadonlySet<string>;
  onAddPrivate: () => void;
  activeSheetId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
}

export default function SheetTabs({
  sheets,
  privateIds,
  onAddPrivate,
  activeSheetId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: SheetTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [errorLeft, setErrorLeft] = useState(8);

  // The rename error floats above the strip, over the tab being renamed. It
  // lives in the strip itself, not in the tab: the tabs sit in a sideways
  // scroller, and a scroller clips both axes, so a message anchored in a tab
  // was cut off by the strip it rose out of.
  const placeError = useCallback(() => {
    const bar = barRef.current;
    const input = inputRef.current;
    const error = errorRef.current;
    if (!bar || !input || !error) return;
    const barBox = bar.getBoundingClientRect();
    const wanted = input.getBoundingClientRect().left - barBox.left;
    const max = Math.max(8, barBox.width - error.offsetWidth - 8);
    setErrorLeft(Math.round(Math.min(Math.max(8, wanted), max)));
  }, []);
  useLayoutEffect(() => {
    if (!renameError) return;
    placeError();
    window.addEventListener('resize', placeError);
    return () => window.removeEventListener('resize', placeError);
  }, [renameError, placeError]);

  const startRename = (sheet: Sheet) => {
    setEditingId(sheet.id);
    setEditDraft(sheet.name);
    setRenameError(null);
    // Focus the input on next tick
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = async () => {
    if (!editingId) return;
    const trimmed = editDraft.trim();
    const current = sheets.find((s) => s.id === editingId);
    // Empty draft or no change → just close without a mutation.
    if (!trimmed || (current && current.name === trimmed)) {
      setEditingId(null);
      setRenameError(null);
      return;
    }
    try {
      await onRename(editingId, trimmed);
      setEditingId(null);
      setRenameError(null);
    } catch (err) {
      // The engine rejects a duplicate or forbidden name — keep the editor open
      // and surface why, instead of silently reverting.
      setRenameError(describeError(err));
      inputRef.current?.focus();
    }
  };

  const cancelRename = () => {
    setEditingId(null);
    setRenameError(null);
  };

  return (
    <TabBar ref={barRef} role="tablist" aria-label="Spreadsheet sheets">
      <TabScroll onScroll={renameError ? placeError : undefined}>
        {sheets.map((sheet) => {
          const isActive = sheet.id === activeSheetId;
          const isEditing = editingId === sheet.id;
          const isPrivate = privateIds.has(sheet.id);
          const linkedFrom = sheet.linked_from;
          // A workbook keeps at least one shared sheet; private ones can all go.
          const deletable = isPrivate || !!linkedFrom
            || sheets.filter((x) => !privateIds.has(x.id) && !x.linked_from).length > 1;

          return (
            <Tab
              key={sheet.id}
              data-testid={`item-sheet`}
              data-sheet-id={sheet.id}
              $active={isActive}
              data-private={isPrivate || undefined}
              title={isPrivate ? 'Private: only on this node, nobody else sees it'
                : linkedFrom ? `Linked from ${linkedFrom}: read-only, kept up to date` : undefined}
              role="tab"
              aria-selected={isActive}
              onClick={() => !isEditing && onSelect(sheet.id)}
              // A linked sheet is named by the workbook that sends it.
              onDoubleClick={() => { if (!linkedFrom) startRename(sheet); }}
            >
              {isEditing ? (
                <RenameInput
                    ref={inputRef}
                    value={editDraft}
                    $invalid={!!renameError}
                    onChange={(e) => { setEditDraft(e.target.value); if (renameError) setRenameError(null); }}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    data-testid="field-name"
                    aria-label="Rename sheet"
                    aria-invalid={!!renameError}
                    autoFocus
                  />
              ) : (
                <TabName>
                  {isPrivate && <span aria-label="Private">🔒 </span>}
                  {linkedFrom && <span aria-label="Linked">⇆ </span>}
                  {sheet.name}
                </TabName>
              )}
              {!isEditing && deletable && (
                <DeleteBtn
                  aria-label={`Delete ${sheet.name}`}
                  data-testid="action-delete_sheet"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(sheet.id);
                  }}
                  tabIndex={-1}
                >
                  ×
                </DeleteBtn>
              )}
            </Tab>
          );
        })}
      </TabScroll>
      {renameError && editingId && (
        <RenameError ref={errorRef} role="alert" style={{ left: errorLeft }}>{renameError}</RenameError>
      )}

      <AddBtn
        data-testid="action-create_sheet"
        onClick={onAdd}
        aria-label="Add sheet"
        title="Add sheet"
      >
        +
      </AddBtn>
      <AddBtn
        data-testid="action-create_private_sheet"
        onClick={onAddPrivate}
        aria-label="Add private sheet"
        title="Add a private sheet: only on this node, nobody else sees it"
      >
        🔒
      </AddBtn>
    </TabBar>
  );
}

// ── Styled components ────────────────────────────────────────────────────────

/* The tab strip along the sheet card's foot: each sheet a pill, the active
   one lifted onto the card's surface. */
const TabBar = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 46px;
  padding: 0 8px;
  background: color-mix(in srgb, var(--glass-ink) 3%, var(--glass-surface-solid));
  border-top: 1px solid var(--glass-line-strong);
  flex-shrink: 0;
  font-family: var(--glass-font);
`;

const TabScroll = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
  min-width: 0;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;

const Tab = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px 0 14px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  position: relative;
  background: ${(p) => (p.$active ? 'var(--glass-surface-solid)' : 'transparent')};
  box-shadow: ${(p) => (p.$active ? '0 1px 2px rgba(14, 18, 34, 0.08), 0 0 0 1px var(--glass-line-strong)' : 'none')};
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 650 : 500)};
  color: ${(p) => (p.$active ? C.ink : 'var(--glass-ink-2)')};
  transition: background 0.15s, color 0.15s;
  user-select: none;

  &:hover {
    background: ${(p) => (p.$active ? 'var(--glass-surface-solid)' : 'var(--glass-sunken)')};
    color: ${C.ink};
  }
`;

const TabName = styled.span`
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RenameInput = styled.input<{ $invalid: boolean }>`
  font-size: 13px;
  font-weight: 600;
  color: ${C.ink};
  background: ${C.paper};
  border: 1px solid ${(p) => (p.$invalid ? C.danger : C.green)};
  border-radius: 999px;
  padding: 3px 10px;
  width: 110px;
  outline: none;
  box-shadow: 0 0 0 3px
    ${(p) => (p.$invalid ? 'rgba(220, 38, 38, 0.2)' : 'color-mix(in srgb, var(--glass-accent-solid) 20%, transparent)')};
`;

/* Floating message shown above the strip, over the rename input, when the
   engine rejects the new name (duplicate / forbidden characters). Above the
   grid's sticky headers, inside the sheet card. */
const RenameError = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  z-index: 30;
  max-width: min(280px, calc(100% - 16px));
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  color: #fff;
  /* A deep red in both themes: dark mode's lighter danger red is too pale
     under white text. */
  background: #b91c1c;
  border-radius: 10px;
  box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.4);
  white-space: normal;
`;

const DeleteBtn = styled.button`
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
  color: ${C.mutedSoft};
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  padding: 0;
  /* Always faintly visible so "delete" is discoverable; brightens on hover. */
  opacity: 0.5;
  flex-shrink: 0;
  transition: opacity 0.15s, background 0.12s, color 0.12s;
  margin-left: 2px;

  &:hover {
    opacity: 1;
    background: rgba(220, 38, 38, 0.12);
    color: ${C.danger};
  }
`;

const AddBtn = styled.button`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 17px;
  font-weight: 400;
  line-height: 1;
  color: var(--glass-ink-2);
  background: var(--glass-sunken);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: var(--glass-line-strong);
    color: ${C.ink};
  }
  &:focus-visible { outline: 2px solid var(--glass-accent); outline-offset: 2px; }
`;
