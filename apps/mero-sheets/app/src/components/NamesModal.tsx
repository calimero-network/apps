import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';

/**
 * Named ranges: give the current selection a name that any formula can use in
 * place of the reference (`=SUM(Costs)`), and see or delete the names the
 * workbook already has. Names are shared: every collaborator sees them.
 */
export default function NamesModal({
  names,
  selection,
  saving,
  error,
  onDefine,
  onDelete,
  onClose,
}: {
  /** Defined names with their targets as shown (`Budget!B2:B9`). */
  names: { name: string; target: string }[];
  /** The selection a new name would point at, as shown; null with none. */
  selection: string | null;
  saving: boolean;
  error: string | null;
  onDefine: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The contract has the final say (it rejects names that read as cells or
  // columns); this only keeps an obviously unusable name off the wire.
  const valid = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name.trim()) && selection !== null;
  const define = () => {
    if (valid && !saving) {
      onDefine(name.trim());
      setName('');
    }
  };

  return (
    <Overlay onClick={onClose} role="presentation">
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="names-title"
        data-testid="names-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="names-title">Named ranges</h3>
        <p className="sub">Use a name in any formula in place of its range, e.g. <code>=SUM(Costs)</code>.</p>

        <Field>
          <label htmlFor="range-name">
            Name {selection ? <>for <strong>{selection}</strong></> : '(select cells first)'}
          </label>
          <input
            id="range-name"
            ref={inputRef}
            data-testid="field-range-name"
            value={name}
            maxLength={64}
            placeholder="e.g. Costs"
            disabled={saving || selection === null}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') define(); }}
          />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        <PrimaryBtn onClick={define} disabled={!valid || saving} data-testid="action-define-name">
          {saving ? 'Saving…' : 'Define name'}
        </PrimaryBtn>

        {names.length > 0 && (
          <List aria-label="Defined names">
            {names.map((n) => (
              <li key={n.name} data-testid="item-NamedRange">
                <span className="name">{n.name}</span>
                <span className="target">{n.target}</span>
                <button
                  type="button"
                  aria-label={`Delete ${n.name}`}
                  disabled={saving}
                  onClick={() => onDelete(n.name)}
                >
                  ×
                </button>
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
  width: 100%; max-width: 420px;
  background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 18px;
  padding: 28px 26px 24px; box-shadow: 0 40px 90px -40px rgba(14,20,15,0.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: ${pop} 0.22s cubic-bezier(0.22,1,0.36,1) both;
  h3 { font-size: 19px; font-weight: 800; letter-spacing: -0.4px; color: ${C.ink}; margin: 0 0 8px; }
  .sub { font-size: 13.5px; line-height: 1.55; color: ${C.muted}; margin: 0; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: ${C.greenDeep}; }
`;

const Field = styled.div`
  margin: 20px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; }
  label strong { color: ${C.ink}; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
  input {
    width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 14px;
    color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line};
    border-radius: 11px; outline: none;
    &::placeholder { color: ${C.mutedSoft}; }
    &:focus { border-color: ${C.green}; box-shadow: 0 0 0 3px rgba(164,255,17,0.18); }
    &:disabled { opacity: 0.6; }
  }
`;

const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center; width: 100%;
  margin-top: 14px; padding: 12px 18px;
  font-size: 13.5px; font-weight: 600; border-radius: 11px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  transition: background 0.18s, transform 0.15s;
  &:hover:not(:disabled) { background: ${C.greenHover}; transform: translateY(-1px); }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const List = styled.ul`
  list-style: none; margin: 20px 0 0; padding: 0;
  border-top: 1px solid ${C.line};
  li {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 2px; border-bottom: 1px solid ${C.line};
    font-size: 13px;
  }
  .name { font-weight: 600; color: ${C.ink}; }
  .target {
    flex: 1; color: ${C.muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px;
  }
  button {
    border: none; background: transparent; color: ${C.mutedSoft};
    font-size: 17px; cursor: pointer; padding: 0 4px;
    &:hover:not(:disabled) { color: ${C.danger}; }
  }
`;

const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${C.danger};`;
