// New-folder modal. Wraps useFolderOperations.create with a small
// form: alias + optional color + visibility toggle. Permission-gating
// lives on the button that opens this dialog — once here, the caller
// is authorised for this scope.
//
// Depth is capped at MAX_FOLDER_DEPTH (design-spec UX cap, not
// enforced server-side). The check runs against parentFolderId
// before render so the user sees the block up-front rather than
// after typing and submitting.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MAX_ALIAS_LENGTH, MAX_FOLDER_DEPTH } from '@/constants/config';
import { depthOf } from '@/utils/ancestry';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderOperations } from '@/hooks/useFolderOperations';

// Curated preset palette. Tailwind 500-tints — readable against both
// light and dark surfaces. Keeping this short on purpose: the UX goal
// is "pick a color in one click", not "express yourself".
const COLOR_PRESETS: Array<{ value: string; label: string }> = [
  { value: '#3b82f6', label: 'Blue' },
  { value: '#10b981', label: 'Green' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#8b5cf6', label: 'Purple' },
];

interface Props {
  parentFolderId: string | null;
  onClose: () => void;
}

export function NewFolderDialog({ parentFolderId, onClose }: Props) {
  const {
    namespaceId,
    rootGroupId,
    folders,
    registryClient,
    applicationId,
    refetch,
  } = useDriveWorkspace();
  const ops = useFolderOperations(
    registryClient,
    rootGroupId,
    folders.map((f) => ({
      id: f.id,
      parent_id: f.parent_id,
    })),
    applicationId,
    refetch,
  );

  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  // Default to Open: namespace members inherit access via core's
  // parent-walk (PR #2261). Switch to Restricted for explicit-invite
  // folders.
  const [visibility, setVisibility] = useState<'Open' | 'Restricted'>('Open');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentDepth = parentFolderId
    ? depthOf(
        folders.map((f) => ({ id: f.id, parent_id: f.parent_id })),
        parentFolderId,
      )
    : -1; // nothing parents a root-level folder; depth below is 0
  const newDepth = parentDepth + 1;
  const atDepthCap = newDepth >= MAX_FOLDER_DEPTH;

  const trimmed = name.trim();
  const canSubmit =
    !!trimmed &&
    trimmed.length <= MAX_ALIAS_LENGTH &&
    !submitting &&
    !atDepthCap;

  const safeClose = () => {
    if (!submitting) onClose();
  };

  const onCreate = async () => {
    if (!namespaceId || !rootGroupId) {
      setError('Workspace not ready');
      return;
    }
    const alias = name.trim();
    if (!alias) {
      setError('Folder name required');
      return;
    }
    if (alias.length > MAX_ALIAS_LENGTH) {
      setError(`Folder name must be ${MAX_ALIAS_LENGTH} characters or fewer`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await ops.create({
        namespaceId,
        parentGroupId: parentFolderId ?? rootGroupId,
        alias,
        color: color || null,
        visibility,
      });
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={safeClose}
    >
      <div
        className="w-96 rounded-lg border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">
          {parentFolderId ? 'New subfolder' : 'New folder'}
        </h2>

        {atDepthCap ? (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            Folders can't be nested deeper than {MAX_FOLDER_DEPTH} levels.
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Folder name"
                value={name}
                maxLength={MAX_ALIAS_LENGTH}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                disabled={submitting}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) onCreate();
                  if (e.key === 'Escape') safeClose();
                }}
              />
            </label>
            <div className="block text-sm">
              <span className="mb-1 block text-muted-foreground">
                Color (optional)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="No color"
                  aria-pressed={color === ''}
                  onClick={() => {
                    setColor('');
                    setError(null);
                  }}
                  disabled={submitting}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border border-input text-muted-foreground transition hover:border-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                    color === '' ? 'ring-2 ring-ring ring-offset-2 ring-offset-card' : ''
                  }`}
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                    <line x1="4" y1="16" x2="16" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                {COLOR_PRESETS.map((c) => (
                  <button
                    type="button"
                    key={c.value}
                    aria-label={c.label}
                    aria-pressed={color === c.value}
                    onClick={() => {
                      setColor(c.value);
                      setError(null);
                    }}
                    disabled={submitting}
                    className={`h-7 w-7 rounded-full border border-border/50 transition hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 ${
                      color === c.value ? 'ring-2 ring-ring ring-offset-2 ring-offset-card' : ''
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>
            <div className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Visibility</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      value: 'Open' as const,
                      title: 'Open',
                      desc: 'Namespace members can join',
                    },
                    {
                      value: 'Restricted' as const,
                      title: 'Restricted',
                      desc: 'Invite members manually',
                    },
                  ]
                ).map((opt) => {
                  const selected = visibility === opt.value;
                  return (
                    <button
                      type="button"
                      key={opt.value}
                      aria-pressed={selected}
                      onClick={() => setVisibility(opt.value)}
                      disabled={submitting}
                      className={`rounded-md border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? 'border-ring bg-accent'
                          : 'border-input hover:border-ring/60'
                      }`}
                    >
                      <div className="text-sm font-medium">{opt.title}</div>
                      <div className="text-xs text-muted-foreground">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={safeClose}
            disabled={submitting}
          >
            {atDepthCap ? 'Close' : 'Cancel'}
          </Button>
          {!atDepthCap && (
            <Button size="sm" onClick={onCreate} disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
