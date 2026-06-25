// Blocking "set your name" overlay. State-driven: it appears whenever
// the active namespace has no display name for the current member —
// which covers just-created, just-joined, and older nameless
// workspaces alike, with no per-event wiring. Gating on !loading
// avoids a flash for a name that is merely slow to resolve.
//
// Rendered INSIDE the workspace body (an `absolute inset-0` overlay
// over sidebar + main), NOT over the top bar — so the namespace
// switcher and Log out stay reachable as an escape hatch.

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import {
  useMemberDisplayName,
  MAX_DISPLAY_NAME_LEN,
} from '@/hooks/useMemberDisplayName';

// localStorage marker recording that a display name is already set for a
// given (namespace, member). Bridges a mero-react bug (#42) where
// useMemberMetadata can return name=null on a fresh load even though the
// name IS set server-side — without this, the gate re-appears on EVERY
// page refresh. The marker is only ever written once we KNOW a name
// exists (a successful save, or any fetch that returns a real name), and
// names can't be cleared today, so it never suppresses the gate wrongly.
const NAME_SET_PREFIX = 'mero-name-set:';
function nameSetMarkerKey(
  ns: string | null | undefined,
  id: string | null | undefined,
): string | null {
  return ns && id ? `${NAME_SET_PREFIX}${ns}:${id}` : null;
}
function rememberNameSet(key: string | null): void {
  if (!key) return;
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* storage unavailable — in-memory dismissal still applies this session */
  }
}

export function DisplayNameGate() {
  const { namespaceId, selfIdentity } = useDriveWorkspace();
  const { name, loading, error, setName } = useMemberDisplayName(
    namespaceId,
    selfIdentity,
  );
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Close immediately once OUR OWN save succeeds — don't wait for `name`
  // to flip non-null via refetch (see mero-drive#42 note above).
  const [dismissed, setDismissed] = useState(false);

  const markerKey = nameSetMarkerKey(namespaceId, selfIdentity);
  // Whether we've previously confirmed (and persisted) that this member
  // has a name in this namespace. Seeds the gate's visibility so a flaky
  // post-refresh fetch can't re-show it.
  const [knownSet, setKnownSet] = useState(false);

  // Re-arm dismissal + (re)read the persisted marker when the active
  // (namespace, member) changes — a different workspace may legitimately
  // need a name.
  useEffect(() => {
    setDismissed(false);
    // Clear any in-progress draft so a name typed for one workspace
    // doesn't carry over when the user switches to another.
    setDraft('');
    if (!markerKey) {
      setKnownSet(false);
      return;
    }
    try {
      setKnownSet(localStorage.getItem(markerKey) === '1');
    } catch {
      setKnownSet(false);
    }
  }, [markerKey]);

  // The moment a real name is observed from the server, persist the
  // marker so future refreshes trust it even if the hook stops returning
  // the name.
  useEffect(() => {
    if (markerKey && name !== null) {
      rememberNameSet(markerKey);
      setKnownSet(true);
    }
  }, [markerKey, name]);

  if (
    !namespaceId ||
    !selfIdentity ||
    loading ||
    name !== null ||
    dismissed ||
    knownSet
  )
    return null;

  const trimmed = draft.trim();
  const canSave =
    trimmed.length > 0 && trimmed.length <= MAX_DISPLAY_NAME_LEN && !saving;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setName(trimmed);
      rememberNameSet(markerKey);
      setDismissed(true);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-gate-title"
      className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 id="name-gate-title" className="text-lg font-semibold text-foreground">
          Set your name
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Members of this workspace see this name instead of your raw key. You
          can change it later in settings.
        </p>
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaveError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSave();
          }}
          placeholder="Your display name"
          maxLength={MAX_DISPLAY_NAME_LEN}
          autoFocus
          disabled={saving}
          className="mt-4 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        {error && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            Couldn&apos;t load: {error.message}
          </p>
        )}
        {saveError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {saveError}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => void onSave()} disabled={!canSave}>
            {saving ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}
