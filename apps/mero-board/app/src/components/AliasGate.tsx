import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
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
  /** True when the current member already has a display name in this namespace. */
  hasName: boolean;
  /** True once the member list for this namespace has settled (avoids a flash). */
  membersLoaded: boolean;
  onSave: (name: string) => Promise<void>;
}

/**
 * Blocking "set your name" overlay shown on entering a namespace where the
 * current member has no display name. Skippable only via the explicit Skip
 * action, which writes a localStorage marker so it does not re-prompt.
 */
export default function AliasGate({ namespaceId, identity, hasName, membersLoaded, onSave }: Props): React.ReactElement | null {
  const key = namespaceId && identity ? markerKey(namespaceId, identity) : null;
  const [dismissed, setDismissed] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-arm on namespace/identity change; a different workspace may need a name.
  useEffect(() => {
    setDismissed(readMarker(key));
    setDraft('');
    setError(null);
  }, [key]);

  // Persist the marker the moment a real name is observed, so a later cold
  // load that briefly reports no name can't re-prompt.
  useEffect(() => {
    if (key && hasName) writeMarker(key);
  }, [key, hasName]);

  if (!namespaceId || !identity || !membersLoaded || hasName || dismissed) return null;

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= MAX_NAME && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      writeMarker(key);
      setDismissed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name.');
    } finally {
      setSaving(false);
    }
  };

  const skip = () => { writeMarker(key); setDismissed(true); };

  return (
    <Backdrop role="dialog" aria-modal="true" aria-labelledby="alias-gate-title" data-testid="alias-gate">
      <Card onClick={(e) => e.stopPropagation()}>
        <h3 id="alias-gate-title">Set your name</h3>
        <p className="sub">Teammates in this workspace see this name instead of your public key. You can change it later on the Members page.</p>
        <Field>
          <label htmlFor="alias-gate-name">Display name</label>
          <input
            id="alias-gate-name"
            data-testid="alias-gate-name"
            autoFocus
            maxLength={MAX_NAME}
            value={draft}
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
  background: rgba(6,7,9,0.72); backdrop-filter: blur(2px);
`;
const Card = styled.div`
  position: relative; width: 100%; max-width: 420px;
  background: ${t.color.panel}; border: 1px solid ${t.color.borderStrong}; border-radius: ${t.radiusModal};
  padding: 28px 26px 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.55);
  font-family: ${t.font.sans}; color: ${t.color.text};
  h3 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
  .sub { font-size: 13px; line-height: 1.55; color: ${t.color.text2}; margin: 0; }
`;
