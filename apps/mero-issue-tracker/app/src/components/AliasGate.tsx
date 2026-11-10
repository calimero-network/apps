import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import { decideSelfName } from '@calimero-apps/names';
import { Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

const MAX_NAME = 64;
const MARKER_PREFIX = 'issue-tracker:alias-set:';
const markerKey = (ns: string, id: string) => `${MARKER_PREFIX}${ns}:${id}`;

function readMarker(key: string | null): boolean {
  if (!key) return false;
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeMarker(key: string | null): void {
  if (!key) return;
  try { localStorage.setItem(key, '1'); } catch { /* storage unavailable */ }
}

interface Props {
  namespaceId: string | null;
  identity: string | null;
  /** The current member's name in this workspace (org member metadata), or "". */
  orgName: string;
  /** True once the member list for this namespace has settled (avoids a flash). */
  membersLoaded: boolean;
  onSave: (name: string) => Promise<void>;
  /** Called once the name is saved or skipped (the invitation flow continues on it). */
  onDone?: () => void;
}

/**
 * Blocking "your name in this workspace" overlay. The name is asked once per
 * workspace (an org): when creating it (in the create dialog) or right after
 * joining it. Entering a workspace that already has your name never shows
 * this; it is the fallback for a workspace made before names were asked
 * there. Skippable only via the explicit Skip action, which writes a
 * localStorage marker so it does not re-prompt.
 */
export default function AliasGate({ namespaceId, identity, orgName, membersLoaded, onSave, onDone }: Props): React.ReactElement | null {
  const key = namespaceId && identity ? markerKey(namespaceId, identity) : null;
  const decision = decideSelfName({ orgReady: membersLoaded, orgName });
  const hasName = decision.kind === 'use';
  const [dismissed, setDismissed] = useState(false);
  // null until edited: the field starts on the name used for the last workspace.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-arm on namespace/identity change; a different workspace may need a name.
  useEffect(() => {
    setDismissed(readMarker(key));
    setDraft(null);
    setError(null);
  }, [key]);

  // Persist the marker the moment a real name is observed, so a later cold
  // load that briefly reports no name can't re-prompt.
  useEffect(() => {
    if (key && hasName) writeMarker(key);
  }, [key, hasName]);

  if (!namespaceId || !identity || decision.kind !== 'ask' || dismissed) return null;

  const value = draft ?? decision.suggestion;
  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= MAX_NAME && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      writeMarker(key);
      setDismissed(true);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name.');
    } finally {
      setSaving(false);
    }
  };

  const skip = () => { writeMarker(key); setDismissed(true); onDone?.(); };

  return (
    <Backdrop role="dialog" aria-modal="true" aria-labelledby="alias-gate-title" data-testid="alias-gate">
      <Card onClick={(e) => e.stopPropagation()}>
        <h3 id="alias-gate-title">Your name in this workspace</h3>
        <p className="sub">Teammates see this name instead of your public key, in every repository of this workspace. You can change it later on the Members page.</p>
        <Field>
          <label htmlFor="alias-gate-name">Your name in this workspace</label>
          <input
            id="alias-gate-name"
            data-testid="alias-gate-name"
            autoFocus
            maxLength={MAX_NAME}
            value={value}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            placeholder="e.g. ronit"
            disabled={saving}
          />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn data-testid="alias-gate-skip" onClick={skip} disabled={saving}>Skip for now</SecondaryBtn>
          <PrimaryBtn data-testid="alias-gate-save" onClick={() => void save()} disabled={!canSave}>
            {saving ? <Spin /> : 'Continue'}
          </PrimaryBtn>
        </Actions>
      </Card>
    </Backdrop>
  );
}

// Full-viewport blocking overlay: the workspace is unusable until the member
// sets a name or explicitly skips (z-index above every other modal).
const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 110;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: ${t.color.scrim};
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
`;
const Card = styled.div`
  position: relative; width: 100%; max-width: 420px;
  background: ${t.color.panel}; border: 1px solid ${t.color.edge}; border-radius: ${t.radiusModal};
  padding: 30px 28px 26px; box-shadow: ${t.shadowFloat};
  font-family: ${t.font.sans}; color: ${t.color.text};
  h3 { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; margin: 0 0 8px; }
  .sub { font-size: 13px; line-height: 1.55; color: ${t.color.text2}; margin: 0; }
`;
