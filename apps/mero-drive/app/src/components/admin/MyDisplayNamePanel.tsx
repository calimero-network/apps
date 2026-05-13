// "Your display name" — small settings panel where the current user
// can set/update their own per-namespace display name. Backed by
// core's setMemberMetadata (PR #2338); self-edit is always allowed
// so no permission gating is needed here. Admin override (renaming
// other members) is deferred — see PR description for follow-ups.

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';

export function MyDisplayNamePanel() {
  const { namespaceId, selfIdentity } = useDriveWorkspace();
  const { name, loading, error, setName } = useMemberDisplayName(
    namespaceId,
    selfIdentity,
  );
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Mirror the server name into the input when it (re)loads. Without
  // this the input stays empty after a refetch on mount.
  useEffect(() => {
    setDraft(name ?? '');
  }, [name]);

  if (!namespaceId || !selfIdentity) return null;

  const trimmed = draft.trim();
  const dirty = trimmed !== (name ?? '') && trimmed.length > 0;

  const onSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await setName(trimmed);
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
            value={draft}
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
