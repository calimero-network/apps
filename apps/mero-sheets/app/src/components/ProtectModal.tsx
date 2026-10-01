import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';

/**
 * Protected ranges on this sheet: protect the selection (or the whole sheet)
 * so only owners and the people picked here can change it, and change or
 * remove the ones already there. Owners only; the contract enforces it.
 */
export interface ProtectModalItem {
  id: string;
  /** "B2:D9", or "Whole sheet"; null when a corner row or column is gone. */
  where: string | null;
  description: string;
  editors: string[];
}

export default function ProtectModal({
  selection,
  items,
  people,
  saving,
  error,
  onProtect,
  onUpdate,
  onRemove,
  onClose,
}: {
  /** The selection a new protection covers, as shown; null with none. */
  selection: string | null;
  items: ProtectModalItem[];
  /** Everyone who could be allowed to edit (owners always can). */
  people: { id: string; name: string }[];
  saving: boolean;
  error: string | null;
  onProtect: (wholeSheet: boolean, description: string, editors: string[]) => void;
  onUpdate: (id: string, description: string, editors: string[]) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [editors, setEditors] = useState<string[]>([]);
  const [wholeSheet, setWholeSheet] = useState(selection === null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const edit = (item: ProtectModalItem) => {
    setEditing(item.id);
    setDescription(item.description);
    setEditors(item.editors);
  };
  const reset = () => { setEditing(null); setDescription(''); setEditors([]); };
  const toggle = (id: string) => setEditors((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));
  const save = () => {
    if (editing) onUpdate(editing, description.trim(), editors);
    else onProtect(wholeSheet, description.trim(), editors);
    reset();
  };

  return (
    <Overlay onClick={onClose} role="presentation">
      <Dialog role="dialog" aria-modal="true" aria-labelledby="protect-title" data-testid="protect-modal" onClick={(e) => e.stopPropagation()}>
        <h3 id="protect-title">{editing ? 'Change protected range' : 'Protect a range'}</h3>
        <p className="sub">Only owners and the people you pick can change a protected range. Everyone still sees it.</p>

        {!editing && (
          <Choice role="radiogroup" aria-label="What to protect">
            <label>
              <input type="radio" checked={!wholeSheet} disabled={selection === null} onChange={() => setWholeSheet(false)} />
              {selection ? <>The selection <code>{selection}</code></> : 'The selection (select cells first)'}
            </label>
            <label>
              <input type="radio" checked={wholeSheet} onChange={() => setWholeSheet(true)} data-testid="field-protect-sheet" />
              The whole sheet
            </label>
          </Choice>
        )}

        <Field>
          <label htmlFor="protect-desc">Description (optional)</label>
          <input
            id="protect-desc"
            data-testid="field-protect-description"
            value={description}
            maxLength={200}
            placeholder="e.g. Totals, do not edit"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field as="fieldset">
          <legend>Who else may edit it</legend>
          {people.length === 0 && <p className="none">Only owners.</p>}
          {people.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={editors.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.name}
            </label>
          ))}
        </Field>

        {error && <ErrorLine>{error}</ErrorLine>}
        <Buttons>
          {editing && <button type="button" className="ghost" onClick={reset}>Cancel</button>}
          <PrimaryBtn
            onClick={save}
            disabled={saving || (!editing && !wholeSheet && selection === null)}
            data-testid="action-protect"
          >
            {saving ? 'Saving…' : editing ? 'Save' : 'Protect'}
          </PrimaryBtn>
        </Buttons>

        {items.length > 0 && (
          <List aria-label="Protected ranges on this sheet">
            {items.map((p) => (
              <li key={p.id} data-testid="item-Protection">
                <span className="where">{p.where ?? '(range removed)'}</span>
                <span className="desc">{p.description || `${p.editors.length} can edit`}</span>
                <button type="button" disabled={saving} onClick={() => edit(p)}>Edit</button>
                <button type="button" disabled={saving} aria-label="Remove protection" onClick={() => onRemove(p.id)}>×</button>
              </li>
            ))}
          </List>
        )}
      </Dialog>
    </Overlay>
  );
}

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(10px) scale(0.97);}to{opacity:1;transform:none;}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 120;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(14,20,15,0.5); backdrop-filter: blur(4px);
  animation: ${fadeIn} 0.18s ease both;
`;
const Dialog = styled.div`
  width: 100%; max-width: 440px; max-height: calc(100vh - 40px); overflow-y: auto;
  background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 18px;
  padding: 28px 26px 24px; box-shadow: 0 40px 90px -40px rgba(14,20,15,0.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: ${pop} 0.22s cubic-bezier(0.22,1,0.36,1) both;
  h3 { font-size: 19px; font-weight: 800; letter-spacing: -0.4px; color: ${C.ink}; margin: 0 0 8px; }
  .sub { font-size: 13.5px; line-height: 1.55; color: ${C.muted}; margin: 0; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: ${C.greenDeep}; }
`;
const Choice = styled.div`
  display: flex; flex-direction: column; gap: 6px; margin: 18px 0 0;
  label { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: ${C.ink}; }
`;
const Field = styled.div`
  margin: 18px 0 4px; border: none; padding: 0;
  label, legend { display: block; font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; padding: 0; }
  .check { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 400; color: ${C.ink}; margin: 4px 0; }
  .none { margin: 0; font-size: 13px; color: ${C.mutedSoft}; }
  input[type='text'], input:not([type]) {
    width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 14px;
    color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line};
    border-radius: 11px; outline: none;
    &:focus { border-color: ${C.green}; box-shadow: 0 0 0 3px rgba(164,255,17,0.18); }
  }
`;
const Buttons = styled.div`
  display: flex; gap: 8px; margin-top: 14px;
  .ghost { padding: 12px 16px; font-size: 13.5px; border-radius: 11px; cursor: pointer; background: none; border: 1px solid ${C.line}; color: ${C.ink}; }
`;
const PrimaryBtn = styled.button`
  flex: 1; padding: 12px 18px;
  font-size: 13.5px; font-weight: 600; border-radius: 11px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  &:hover:not(:disabled) { background: ${C.greenHover}; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const List = styled.ul`
  list-style: none; margin: 20px 0 0; padding: 0; border-top: 1px solid ${C.line};
  li { display: flex; align-items: center; gap: 10px; padding: 9px 2px; border-bottom: 1px solid ${C.line}; font-size: 13px; }
  .where { font-weight: 600; color: ${C.ink}; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; }
  .desc { flex: 1; color: ${C.muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { border: none; background: transparent; color: ${C.mutedSoft}; font-size: 12.5px; cursor: pointer; padding: 0 4px; }
  button:hover:not(:disabled) { color: ${C.ink}; }
`;
const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${C.danger};`;
