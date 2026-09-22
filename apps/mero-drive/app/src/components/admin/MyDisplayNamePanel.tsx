// The caller's own per-namespace display name, via setMemberMetadata; self-edit
// is always allowed, so nothing here is permission-gated.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';

export function MyDisplayNamePanel() {
  const { namespaceId, selfIdentity, namespaceMemberNames } =
    useDriveWorkspace();
  const {
    name: hookName,
    loading,
    error,
    setName,
  } = useMemberDisplayName(namespaceId, selfIdentity);
  // The metadata hook can read null while the member rows already carry the
  // name; fall back to those rows so this panel and the members list agree.
  const name =
    hookName ??
    (selfIdentity ? namespaceMemberNames[selfIdentity] ?? null : null);
  // null until the user types, so the input shows the stored name in the same
  // render it loads and a late-loading name never overwrites an edit.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!namespaceId || !selfIdentity) return null;

  const value = draft ?? name ?? '';
  const trimmed = value.trim();
  const dirty = trimmed !== (name ?? '') && trimmed.length > 0;

  const onSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await setName(trimmed);
      setDraft(null);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-lg border border-border bg-card"
      data-testid="my-display-name-panel"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          Your display name
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Other members of this workspace see this name in member lists and
          folder sharing panels. Only you can change it.
        </p>
      </header>
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={name ?? 'Not set yet'}
            maxLength={64}
            disabled={loading || saving}
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            size="sm"
            disabled={!dirty || saving || loading}
            onClick={() => void onSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            Couldn&apos;t load: {error.message}
          </p>
        )}
        {saveError && (
          <p className="text-xs text-destructive" role="alert">
            {saveError}
          </p>
        )}
      </div>
    </section>
  );
}
