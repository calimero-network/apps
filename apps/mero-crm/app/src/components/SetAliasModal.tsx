import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens as t } from '../theme';

interface SetAliasModalProps {
  /** True for the first-join nudge (softer copy, "Skip" instead of "Cancel"). */
  firstJoin?: boolean;
  onSave: (alias: string) => Promise<void>;
  onClose: () => void;
}

export default function SetAliasModal({ firstJoin, onSave, onClose }: SetAliasModalProps) {
  const [alias, setAlias] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const handleSave = async () => {
    const next = alias.trim();
    if (!next || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set alias.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay onClick={() => !saving && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="alias-title">
        <Close onClick={() => !saving && onClose()} aria-label="Close">×</Close>

        <h3 id="alias-title">{firstJoin ? 'Welcome - set your alias' : 'Set my alias'}</h3>
        <p className="sub">
          {firstJoin
            ? 'Give teammates a name to see instead of your public key.'
            : 'Choose a name teammates will see instead of your public key.'}
        </p>

        <Field>
          <label htmlFor="alias-input">Alias</label>
          <input
            id="alias-input"
            data-testid="alias-input"
            autoFocus
            value={alias}
            onChange={(e) => { setAlias(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            placeholder="e.g. ronit"
            disabled={saving}
          />
        </Field>

        {error && <ErrorLine>{error}</ErrorLine>}

        <Actions>
          <SecondaryBtn onClick={onClose} disabled={saving}>{firstJoin ? 'Skip' : 'Cancel'}</SecondaryBtn>
          <PrimaryBtn data-testid="alias-save-btn" onClick={handleSave} disabled={!alias.trim() || saving}>
            {saving ? <Spin /> : 'Save alias'}
          </PrimaryBtn>
        </Actions>
      </Dialog>
    </Overlay>
  );
}

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}`;
const spin = keyframes`to{transform:rotate(360deg);}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(6,7,9,0.6);
  animation: ${fadeIn} 0.15s ease both;
`;
const Dialog = styled.div`
  position: relative; width: 100%; max-width: 400px;
  background: ${t.color.panel}; border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radiusModal};
  padding: 28px 26px 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.55);
  font-family: ${t.font.sans}; color: ${t.color.text};
  animation: ${pop} 0.18s ease both;
  h3 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
  .sub { font-size: 13px; line-height: 1.55; color: ${t.color.text2}; margin: 0; }
`;
const Close = styled.button`
  position: absolute; top: 14px; right: 14px; width: 30px; height: 30px;
  display: grid; place-items: center; font-size: 20px; line-height: 1;
  color: ${t.color.text3}; background: transparent; border: none; border-radius: 6px; cursor: pointer;
  &:hover { background: rgba(255,255,255,0.05); color: ${t.color.text}; }
`;
const Field = styled.div`
  margin: 22px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${t.color.text2}; margin-bottom: 7px; }
  input {
    width: 100%; box-sizing: border-box;
    font-size: 13px; color: ${t.color.text}; background: ${t.color.raised};
    border: 1px solid ${t.color.border}; border-radius: ${t.radius}; padding: 10px 12px;
    outline: none; font-family: inherit;
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-color: ${t.color.accentBorder}; }
    &:disabled { opacity: 0.6; }
  }
`;
const Actions = styled.div`display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;`;
const btn = `
  padding: 10px 18px; font-size: 13px; font-weight: 600; border-radius: ${t.radius}; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:disabled { opacity: 0.6; cursor: default; }
`;
const SecondaryBtn = styled.button`
  ${btn}
  color: ${t.color.text}; background: ${t.color.raised}; border: 1px solid ${t.color.border};
  &:hover:not(:disabled) { background: ${t.color.raised2}; }
`;
const PrimaryBtn = styled.button`
  ${btn}
  min-width: 120px; display: inline-flex; align-items: center; justify-content: center;
  color: ${t.color.onAccent}; background: ${t.color.accent}; border: 1px solid transparent;
  &:hover:not(:disabled) { background: #b6ff5e; }
`;
const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${t.color.urgent};`;
const Spin = styled.span`
  width: 15px; height: 15px; border: 2px solid rgba(12,16,5,0.3); border-top-color: ${t.color.onAccent};
  border-radius: 50%; animation: ${spin} 0.6s linear infinite;
`;
