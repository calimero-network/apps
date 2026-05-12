// "Member defaults" admin section — sets the capability bitmask that
// every NEW member of this namespace inherits when they join by invite
// (core's `default_capabilities`, per design spec §5.2). Existing
// members are unaffected; this only changes what future joiners get.
//
// Gated on `canManageNamespace` (returns null otherwise) so the
// settings surface doesn't advertise an action the caller can't take.
//
// The checklist is the namespace-relevant subset of core's
// `MemberCapabilities` bits. Toggling a checkbox edits a local `draft`
// mask; "Save defaults" pushes it via mero-react's
// `useSetDefaultCapabilities`. The "Editor" preset
// (`DEFAULT_NEW_MEMBER_CAPS`, = 37) is the default and the
// reset target.

import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  useDefaultCapabilities,
  useSetDefaultCapabilities,
} from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import {
  CAPABILITIES,
  DEFAULT_NEW_MEMBER_CAPS,
  hasCap,
  withCap,
  withoutCap,
} from '@/constants/config';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';

const C = CAPABILITIES;

// Order matters — the most-common grants first so the checklist reads
// "what a normal collaborator gets" at the top, "elevated" below.
const CAP_ROWS: { bit: number; label: string; hint: string }[] = [
  {
    bit: C.CAN_JOIN_OPEN_SUBGROUPS,
    label: 'Join open folders',
    hint: 'See and edit folders shared with the whole workspace.',
  },
  {
    bit: C.CAN_CREATE_SUBGROUP,
    label: 'Create folders',
    hint: 'Add new top-level folders.',
  },
  {
    bit: C.CAN_CREATE_CONTEXT,
    label: 'Create documents',
    hint: 'Add documents inside folders they can access.',
  },
  {
    bit: C.CAN_INVITE_MEMBERS,
    label: 'Invite members',
    hint: 'Generate invite links to folders / the workspace.',
  },
  {
    bit: C.MANAGE_MEMBERS,
    label: 'Manage members',
    hint: 'Add, remove, and re-role other members.',
  },
  {
    bit: C.CAN_MANAGE_VISIBILITY,
    label: 'Change folder visibility',
    hint: 'Switch folders between open and restricted.',
  },
  {
    bit: C.CAN_MANAGE_METADATA,
    label: 'Rename folders',
    hint: 'Change folder display names and colors.',
  },
  {
    bit: C.CAN_DELETE_SUBGROUP,
    label: 'Delete folders',
    hint: 'Remove folders (and everything inside).',
  },
];

export function MemberDefaultsPanel() {
  const { namespaceId, rootGroupId } = useDriveWorkspace();
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const { defaultCapabilities, loading, error, refetch } =
    useDefaultCapabilities(namespaceId ?? undefined);
  const { setDefaultCapabilities, loading: saving } =
    useSetDefaultCapabilities();

  // The committed value the server currently has — null until loaded.
  // Once loaded, an unset default reads as `DEFAULT_NEW_MEMBER_CAPS`
  // (the "Editor" preset) so the checklist isn't all-unchecked for a
  // namespace created before this code ran.
  const current = defaultCapabilities ?? null;
  const [draft, setDraft] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed `draft` from the loaded value once. After that the user owns
  // it (don't clobber edits if `defaultCapabilities` re-fires with the
  // same value).
  useEffect(() => {
    if (loading) return;
    if (draft !== null) return;
    setDraft(current ?? DEFAULT_NEW_MEMBER_CAPS);
  }, [loading, draft, current]);

  const effectiveCurrent = current ?? DEFAULT_NEW_MEMBER_CAPS;
  const dirty = useMemo(
    () => draft !== null && draft !== effectiveCurrent,
    [draft, effectiveCurrent],
  );

  if (!perms.canManageNamespace) return null;
  if (!namespaceId) return null;

  const toggle = (bit: number) => {
    setDraft((d) => {
      const base = d ?? effectiveCurrent;
      return hasCap(base, bit) ? withoutCap(base, bit) : withCap(base, bit);
    });
  };

  const onSave = async () => {
    if (draft === null) return;
    setSaveError(null);
    try {
      await setDefaultCapabilities(namespaceId, {
        defaultCapabilities: draft,
      });
      await refetch();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setSaveError(err.message);
    }
  };

  const shown = draft ?? effectiveCurrent;

  return (
    <section
      aria-labelledby="member-defaults-heading"
      data-testid="member-defaults"
      className="rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <h3
          id="member-defaults-heading"
          className="text-sm font-semibold text-foreground"
        >
          Member defaults
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          New members joining this workspace via invite get these
          capabilities. Existing members are unaffected.
        </p>
      </header>

      {error && (
        <p
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          Couldn't load current defaults: {error.message}
        </p>
      )}

      <div className="space-y-2 px-4 py-3">
        {CAP_ROWS.map((row) => (
          <label
            key={row.bit}
            className="flex cursor-pointer items-start gap-2.5 text-sm"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={hasCap(shown, row.bit)}
              disabled={loading || saving}
              onChange={() => toggle(row.bit)}
            />
            <span className="min-w-0">
              <span className="font-medium text-foreground">{row.label}</span>
              <span className="block text-xs text-muted-foreground">
                {row.hint}
              </span>
            </span>
          </label>
        ))}
      </div>

      {saveError && (
        <p className="px-4 pb-2 text-xs text-destructive" role="alert">
          Save failed: {saveError}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          disabled={loading || saving || draft === DEFAULT_NEW_MEMBER_CAPS}
          onClick={() => setDraft(DEFAULT_NEW_MEMBER_CAPS)}
        >
          <RotateCcw className="h-3 w-3" />
          Reset to Editor preset
        </button>
        <Button
          size="sm"
          disabled={loading || saving || !dirty}
          onClick={() => {
            void onSave();
          }}
        >
          {saving ? 'Saving…' : 'Save defaults'}
        </Button>
      </div>
    </section>
  );
}
