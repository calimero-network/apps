// Shared invite-link dialog. Parameterised by scope so the same
// component serves both namespace-wide invites (from the Workspace
// settings panel) and folder-scoped invites (from the folder's
// Sharing panel). The only things that differ between the two are
// the title/body copy and the create-function handed in; everything
// else — the generate → display → copy interaction — is identical.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check, Link2 } from 'lucide-react';
import type { InviteCreation } from '@/hooks/useNamespaceInvitation';

interface Props {
  title: string;
  /** Short sentence shown under the title explaining what the invite
   *  grants. E.g. "Share this link with people you want to give
   *  access to workspace X." */
  description: React.ReactNode;
  /** Returns a resolved InviteCreation with a ready-to-copy URL. */
  onCreate: () => Promise<InviteCreation>;
  onClose: () => void;
  /** Optional free-text shown under the link, e.g. scope clarification. */
  footnote?: string;
}

export function InviteDialog({
  title,
  description,
  onCreate,
  onClose,
  footnote,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  // Distinct from `copied`: the clipboard write failed but we selected
  // the input as a fallback. Surfaces a banner so the user knows to
  // hit Cmd/Ctrl+C themselves.
  const [copyFallback, setCopyFallback] = useState(false);

  const onGenerate = async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await onCreate();
      setUrl(result.url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const onCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFallback(false);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on http:// or with no user gesture.
      // Fall back to selecting the link so users can Cmd+C manually
      // — and surface the failure so they know to actually do it.
      const el = document.getElementById('invite-url-text');
      if (el instanceof HTMLInputElement) el.select();
      setCopyFallback(true);
      setTimeout(() => setCopyFallback(false), 5000);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="invite-dialog-title"
          className="mb-1 text-base font-semibold"
        >
          {title}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>

        {!url && !error && (
          <Button
            onClick={onGenerate}
            disabled={creating}
            className="w-full"
            size="sm"
          >
            <Link2 className="mr-2 h-3.5 w-3.5" />
            {creating ? 'Generating…' : 'Generate invite link'}
          </Button>
        )}

        {url && (
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">
              Invite link
            </label>
            <div className="flex gap-2">
              <input
                id="invite-url-text"
                readOnly
                value={url}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={onCopy}
                aria-label="Copy invite link"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {footnote && (
              <p className="text-xs text-muted-foreground">{footnote}</p>
            )}
            {copyFallback && (
              <p
                className="text-xs text-amber-600 dark:text-amber-400"
                role="status"
              >
                Couldn't copy automatically — the link is selected
                above; press <kbd className="rounded border px-1">⌘/Ctrl</kbd>
                + <kbd className="rounded border px-1">C</kbd> to copy.
              </p>
            )}
          </div>
        )}

        {error && (
          <div
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
