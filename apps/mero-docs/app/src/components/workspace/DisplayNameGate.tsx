// Blocking "set your name" overlay: the fallback for a workspace that has
// no name for you. Your name is asked once per workspace - in the New
// workspace dialog, or right after accepting an invitation - so this only
// shows for workspaces made before that (or when that write was refused).
// It decides only once the name read has answered (`decideSelfName`), and a
// background refetch never hides it.
//
// Rendered INSIDE the workspace body (an `absolute inset-0` overlay
// over sidebar + main), NOT over the top bar - so the namespace
// switcher and Log out stay reachable as an escape hatch.

import React, { useEffect, useState } from 'react';
import { decideSelfName, lastUsedName } from '@calimero-apps/names';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import {
  useMemberDisplayName,
  MAX_DISPLAY_NAME_LEN,
} from '@/hooks/useMemberDisplayName';

// localStorage marker recording that a display name is already set for a
// given (namespace, member). Bridges a gap where
// useMemberMetadata can return name=null on a fresh load even though the
// name IS set server-side - without this, the gate re-appears on EVERY
// page refresh. The marker is only ever written once we KNOW a name
// exists (a successful save, or any fetch that returns a real name), and
// names can't be cleared today, so it never suppresses the gate wrongly.
const NAME_SET_PREFIX = 'mero-name-set:';
function rememberNameSet(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* storage unavailable - in-memory dismissal still applies this session */
  }
}

export function DisplayNameGate() {
  const { namespaceId, selfIdentity } = useDriveWorkspace();
  if (!namespaceId || !selfIdentity) return null;
  // One instance per namespace: a name fetch still in flight for the previous
  // workspace resolves into the unmounted instance instead of this one.
  return (
    <NameGate
      key={namespaceId}
      namespaceId={namespaceId}
      selfIdentity={selfIdentity}
    />
  );
}

function NameGate({
  namespaceId,
  selfIdentity,
}: {
  namespaceId: string;
  selfIdentity: string;
}) {
  const { namespaceMemberNames } = useDriveWorkspace();
  const { name, loaded, error, setName, refetch } = useMemberDisplayName(
    namespaceId,
    selfIdentity,
  );
  // The name as seen by the rest of the app's member surfaces: the
  // namespace GroupMember rows (keyed by identity), which reliably carry
  // the name even when `useMemberDisplayName` returns null on a cold load
  // (a read still in flight). This is the same source the members
  // list + the settings panel use, so the gate agrees with them.
  const memberRowName = namespaceMemberNames[selfIdentity] ?? null;
  // The effective name from ANY reliable source.
  const effectiveName = name ?? memberRowName;
  // Close immediately once OUR OWN save succeeds - don't wait for `name`
  // to flip non-null via refetch (see the marker note above).
  const [dismissed, setDismissed] = useState(false);

  const markerKey = `${NAME_SET_PREFIX}${namespaceId}:${selfIdentity}`;
  // Whether we've previously confirmed (and persisted) that this member
  // has a name in this namespace. Seeds the gate's visibility so a flaky
  // post-refresh fetch can't re-show it.
  const [knownSet, setKnownSet] = useState(() => {
    try {
      return localStorage.getItem(markerKey) === '1';
    } catch {
      return false;
    }
  });

  // The moment a real name is observed from ANY reliable source (the
  // metadata hook OR the namespace member rows), persist the marker so
  // future refreshes trust it even if the hook stops returning the name.
  useEffect(() => {
    if (effectiveName !== null) {
      rememberNameSet(markerKey);
      setKnownSet(true);
    }
  }, [markerKey, effectiveName]);

  // Suppress the gate when the name is known from ANY reliable source.
  // Gating on `effectiveName` (not just the flaky hook `name`) is the fix
  // for the gate re-prompting on a cold/long-gap session: even if the
  // localStorage marker is gone (new device, cleared storage) AND the
  // hook returns null, the member rows still show the name, so we
  // must not ask the user to set it again.
  const decision = decideSelfName({ orgReady: loaded, orgName: effectiveName });
  if (decision.kind === 'wait') return null;
  // The gate decides after an async read, so a wait for "gate or no gate"
  // needs a definite end: this marker says the decision was "no gate".
  if (decision.kind !== 'ask' || dismissed || knownSet) {
    return <span hidden data-testid="name-gate-settled" />;
  }

  const onSave = async (next: string) => {
    await setName(next);
    rememberNameSet(markerKey);
    setDismissed(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-gate-title"
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2
          id="name-gate-title"
          className="text-lg font-semibold text-foreground"
        >
          Your name in this workspace
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Members of this workspace see this name in every folder and doc. You
          can change it later in settings.
        </p>
        <SelfNameForm
          suggestion={decision.suggestion}
          onSave={onSave}
          loadFailed={!!error}
          onRetry={() => void refetch()}
        />
      </div>
    </div>
  );
}

/**
 * The name field and its Continue button: the gate's, and the invitation
 * prompt's right after joining. `onSave` throws to say the save failed.
 */
export function SelfNameForm({
  suggestion = lastUsedName(),
  onSave,
  loadFailed = false,
  onRetry,
}: {
  suggestion?: string;
  onSave: (name: string) => Promise<void>;
  loadFailed?: boolean;
  onRetry?: () => void;
}) {
  const [draft, setDraft] = useState(suggestion);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const trimmed = draft.trim();
  const canSave =
    trimmed.length > 0 && trimmed.length <= MAX_DISPLAY_NAME_LEN && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave(trimmed);
    } catch (e: unknown) {
      console.warn('display name save failed', e);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaveFailed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
        placeholder="Your display name"
        maxLength={MAX_DISPLAY_NAME_LEN}
        autoFocus
        disabled={saving}
        className="mt-4 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      {loadFailed && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          Couldn&apos;t load your name. Try again.
        </p>
      )}
      {saveFailed && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          Couldn&apos;t save your name. Try again.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {loadFailed && onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button size="sm" onClick={() => void save()} disabled={!canSave}>
          {saving ? 'Saving…' : 'Continue'}
        </Button>
      </div>
    </>
  );
}
