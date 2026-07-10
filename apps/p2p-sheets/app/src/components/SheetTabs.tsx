/**
 * SheetTabs — tab bar at the bottom of the spreadsheet.
 *
 * Each tab:
 *  - Click → switch to that sheet
 *  - Double-click → rename inline
 *  - Hover × button → delete (disabled for the last sheet)
 *
 * "+" button adds a new sheet.
 */
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { type Sheet } from '../hooks/useSpreadsheet';
import { describeError } from '../utils/errors';

interface SheetTabsProps {
  sheets: Sheet[];
  activeSheetId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
}

export default function SheetTabs({
  sheets,
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
    <TabBar role="tablist" aria-label="Spreadsheet sheets">
      <TabScroll>
        {sheets.map((sheet) => {
          const isActive = sheet.id === activeSheetId;
          const isEditing = editingId === sheet.id;

          return (
            <Tab
              key={sheet.id}
              data-testid={`item-sheet`}
              data-sheet-id={sheet.id}
              $active={isActive}
              role="tab"
              aria-selected={isActive}
              onClick={() => !isEditing && onSelect(sheet.id)}
              onDoubleClick={() => startRename(sheet)}
            >
              {isEditing ? (
                <>
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
                  {renameError && <RenameError role="alert">{renameError}</RenameError>}
                </>
              ) : (
                <TabName>{sheet.name}</TabName>
              )}
              {!isEditing && sheets.length > 1 && (
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

      <AddBtn
        data-testid="action-create_sheet"
        onClick={onAdd}
        aria-label="Add sheet"
        title="Add sheet"
      >
        +
      </AddBtn>
    </TabBar>
  );
}

// ── Styled components ────────────────────────────────────────────────────────

const TabBar = styled.div`
  display: flex;
  align-items: stretch;
  height: 36px;
  background: ${C.paper2};
  border-top: 1px solid ${C.line};
  flex-shrink: 0;
  overflow: hidden;
`;

const TabScroll = styled.div`
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;

const Tab = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  position: relative;
  background: ${(p) => (p.$active ? C.paper : 'transparent')};
  border-right: 1px solid ${C.line};
  border-top: ${(p) => (p.$active ? `2px solid ${C.green}` : '2px solid transparent')};
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  color: ${(p) => (p.$active ? C.ink : C.muted)};
  transition: background 0.15s, color 0.15s;
  user-select: none;

  &:hover {
    background: ${(p) => (p.$active ? C.paper : C.paper2)};
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
  border-radius: 4px;
  padding: 2px 6px;
  width: 100px;
  outline: none;
  box-shadow: 0 0 0 3px
    ${(p) => (p.$invalid ? 'rgba(220, 38, 38, 0.2)' : 'rgba(164, 255, 17, 0.2)')};
`;

/* Floating message shown above the rename input when the engine rejects the
   new name (duplicate / forbidden characters). */
const RenameError = styled.div`
  position: absolute;
  bottom: calc(100% + 4px);
  left: 6px;
  z-index: 30;
  max-width: 220px;
  padding: 5px 8px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.3;
  color: #fff;
  background: ${C.danger};
  border-radius: 6px;
  box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.4);
  white-space: normal;
`;

const DeleteBtn = styled.button`
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
  color: ${C.mutedSoft};
  background: transparent;
  border: none;
  border-radius: 4px;
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
  width: 36px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 300;
  color: ${C.muted};
  background: transparent;
  border: none;
  border-left: 1px solid ${C.line};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: ${C.paper};
    color: ${C.ink};
  }
`;
