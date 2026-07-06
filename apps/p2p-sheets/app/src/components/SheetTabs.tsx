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

interface SheetTabsProps {
  sheets: Sheet[];
  activeSheetId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
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
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (sheet: Sheet) => {
    setEditingId(sheet.id);
    setEditDraft(sheet.name);
    // Focus the input on next tick
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (!editingId) return;
    const trimmed = editDraft.trim();
    if (trimmed) onRename(editingId, trimmed);
    setEditingId(null);
  };

  const cancelRename = () => setEditingId(null);

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
                <RenameInput
                  ref={inputRef}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  data-testid="field-name"
                  aria-label="Rename sheet"
                  autoFocus
                />
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

  /* Reveal the delete button on hover */
  &:hover .delete-btn { opacity: 1; }

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

const RenameInput = styled.input`
  font-size: 13px;
  font-weight: 600;
  color: ${C.ink};
  background: ${C.paper};
  border: 1px solid ${C.green};
  border-radius: 4px;
  padding: 2px 6px;
  width: 100px;
  outline: none;
  box-shadow: 0 0 0 3px rgba(164, 255, 17, 0.2);
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
  opacity: 0;
  flex-shrink: 0;
  transition: opacity 0.15s, background 0.12s, color 0.12s;
  margin-left: 2px;

  &:hover {
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
