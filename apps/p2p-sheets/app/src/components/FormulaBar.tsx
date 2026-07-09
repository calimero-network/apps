/**
 * FormulaBar — cell reference display + formula/value input with autocomplete.
 *
 * Layout: [ A1 ] [ fx ] [━━━━━━ input ━━━━━━]
 *
 * Autocomplete triggers when the value matches `=<letters>` (e.g. `=SU`),
 * showing functions whose names start with those letters. Selecting a suggestion
 * inserts `=FuncName(` into the input.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import { type FunctionDef } from '../hooks/useSpreadsheet';

// ── Helpers ──────────────────────────────────────────────────────────────────

function colLetter(col: number): string {
  return String.fromCharCode(65 + col); // 0→A, 1→B, …
}

export function cellRef(row: number, col: number): string {
  return `${colLetter(col)}${row + 1}`;
}

// ── Component ────────────────────────────────────────────────────────────────

interface FormulaBarProps {
  selectedCell: { row: number; col: number } | null;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** Fired when the user actively begins editing (clicks into the input), so
   *  the page can enter edit mode and route subsequent cell clicks as refs. */
  onBeginEdit?: () => void;
  functions: FunctionDef[];
  disabled?: boolean;
  /** Shared ref to the underlying input, so the page can read/set the caret
   *  for point-mode reference insertion. Falls back to an internal ref. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** True while the user is actively editing a formula. When false, the bar is
   *  merely focused for quick-typing after a selection, and clipboard/Delete
   *  keys act on the grid selection rather than the input text. */
  editing?: boolean;
  /** Clipboard events on the input — the page hijacks them when not editing to
   *  copy/cut/paste the grid selection (the input is the reliably-focused
   *  element after a cell selection, so this is where the browser fires them). */
  onCopy?: (e: React.ClipboardEvent) => void;
  onCut?: (e: React.ClipboardEvent) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  /** Clear the grid selection (Delete/Backspace when not editing). */
  onGridDelete?: () => void;
  /** Clear the copied-region outline (Escape when not editing). */
  onGridClearClipboard?: () => void;
}

export default function FormulaBar({
  selectedCell,
  value,
  onChange,
  onCommit,
  onCancel,
  onBeginEdit,
  functions,
  disabled,
  inputRef: externalInputRef,
  editing = false,
  onCopy,
  onCut,
  onPaste,
  onGridDelete,
  onGridClearClipboard,
}: FormulaBarProps) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;
  const [acOpen, setAcOpen] = useState(false);

  // Autocomplete: show for `=<letters-only>` — hides once `(` is typed
  const acMatch = /^=([A-Za-z]*)$/.exec(value);
  const acPrefix = acMatch ? acMatch[1] : null;
  const suggestions: FunctionDef[] =
    acPrefix !== null
      ? acPrefix === ''
        ? functions
        : functions.filter((f) =>
            f.name.toUpperCase().startsWith(acPrefix.toUpperCase()),
          )
      : [];

  useEffect(() => {
    setAcOpen(acPrefix !== null && suggestions.length > 0);
  }, [acPrefix, suggestions.length]);

  // Auto-focus the input when a cell is selected, so you can start typing
  // immediately after clicking a cell (no second click into the formula bar).
  // Keyed on row/col so it re-focuses on every selection change, not on each
  // keystroke-driven re-render.
  useEffect(() => {
    if (selectedCell && !disabled) {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCell?.row, selectedCell?.col, disabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Not editing: the bar is focused only because a cell is selected, so
    // Delete/Backspace clears the grid selection and Escape clears the copied
    // outline — the keys act on the sheet, not the (unentered) input text.
    if (!editing) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onGridDelete?.();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAcOpen(false);
        onGridClearClipboard?.();
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      setAcOpen(false);
      onCommit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setAcOpen(false);
      onCancel();
    }
    if (e.key === 'Tab') {
      // If autocomplete open + exactly one match, accept it
      if (acOpen && suggestions.length === 1) {
        e.preventDefault();
        selectSuggestion(suggestions[0].name);
      }
    }
  };

  const selectSuggestion = useCallback(
    (name: string) => {
      onChange(`=${name}(`);
      setAcOpen(false);
      inputRef.current?.focus();
    },
    [onChange],
  );

  const ref = selectedCell ? cellRef(selectedCell.row, selectedCell.col) : '';

  return (
    <Bar>
      <CellRef aria-label="Cell reference">{ref || '—'}</CellRef>
      <Divider />
      <FxLabel aria-hidden="true">fx</FxLabel>
      <InputWrap>
        <Input
          ref={inputRef}
          data-testid="field-raw_value"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
          onMouseDown={() => onBeginEdit?.()}
          onBlur={() => setAcOpen(false)}
          disabled={disabled || !selectedCell}
          placeholder={
            selectedCell
              ? 'Enter value or formula  (=SUM, =IF, =AVERAGE, …)'
              : 'Select a cell to edit'
          }
          spellCheck={false}
          autoComplete="off"
          aria-label="Formula bar"
          aria-autocomplete="list"
        />
        {acOpen && (
          <Dropdown role="listbox" aria-label="Function suggestions">
            {suggestions.map((fn) => (
              <DropdownItem
                key={fn.name}
                role="option"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur on input before mouseup
                  selectSuggestion(fn.name);
                }}
              >
                <span className="fn-name">{fn.name}</span>
                <span className="fn-syntax">{fn.syntax}</span>
              </DropdownItem>
            ))}
          </Dropdown>
        )}
      </InputWrap>
    </Bar>
  );
}

// ── Styled components ────────────────────────────────────────────────────────

const dropIn = keyframes`
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: none; }
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  height: 40px;
  background: ${C.paper};
  border-bottom: 1px solid ${C.line};
  flex-shrink: 0;
  gap: 0;
  position: relative;
  z-index: 10;
`;

const CellRef = styled.div`
  width: 72px;
  flex-shrink: 0;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${C.ink};
  padding: 0 8px;
  letter-spacing: 0.04em;
`;

const Divider = styled.div`
  width: 1px;
  height: 100%;
  background: ${C.line};
  flex-shrink: 0;
`;

const FxLabel = styled.div`
  width: 36px;
  flex-shrink: 0;
  text-align: center;
  font-size: 12px;
  font-style: italic;
  color: ${C.muted};
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  border-right: 1px solid ${C.line};
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const InputWrap = styled.div`
  flex: 1;
  position: relative;
  height: 100%;
`;

const Input = styled.input`
  width: 100%;
  height: 100%;
  padding: 0 10px;
  font-size: 13.5px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${C.ink};
  background: transparent;
  border: none;
  outline: none;

  &:focus {
    background: rgba(59, 130, 246, 0.04);
  }

  &::placeholder {
    color: ${C.mutedSoft};
    font-style: italic;
    font-size: 13px;
  }

  &:disabled {
    color: ${C.disabled};
    cursor: default;
  }
`;

const Dropdown = styled.div`
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  background: ${C.paper};
  border: 1px solid ${C.line};
  border-radius: 10px;
  box-shadow: 0 12px 32px -12px rgba(14, 20, 15, 0.25);
  z-index: 100;
  overflow: hidden;
  animation: ${dropIn} 0.15s cubic-bezier(0.22, 1, 0.36, 1);
  max-height: 260px;
  overflow-y: auto;
`;

const DropdownItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  cursor: pointer;
  transition: background 0.12s;

  &:hover {
    background: ${C.paper2};
  }

  .fn-name {
    font-size: 13px;
    font-weight: 700;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    color: ${C.green};
    min-width: 70px;
    flex-shrink: 0;
  }

  .fn-syntax {
    font-size: 12px;
    color: ${C.muted};
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
