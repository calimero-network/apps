// Shown in place of the folder content when the caller can't read
// this folder — either the folder is Restricted and they're not on
// the member list, or the admin-api rejected their caps query with
// "not a member". Gives them a way to copy their identity so they
// can ask an admin for access.

import React, { useState } from 'react';
import { Lock, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  folderAlias: string;
  visibility: 'Inherit' | 'Restricted';
  selfIdentity: string | null;
}

export function RestrictedFolderCard({
  folderAlias,
  visibility,
  selfIdentity,
}: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!selfIdentity) return;
    try {
      await navigator.clipboard.writeText(selfIdentity);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fall back to select — users can Cmd+C manually.
      const el = document.getElementById('restricted-identity-text');
      if (el instanceof HTMLInputElement) el.select();
    }
  };

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
          <Lock className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {visibility === 'Restricted'
              ? 'This folder is restricted'
              : "You're not yet a member of this folder"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {visibility === 'Restricted' ? (
              <>
                Only explicit members can see{' '}
                <span className="font-medium text-foreground">
                  {folderAlias}
                </span>
                's documents. Ask an owner to add you.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {folderAlias}
                </span>{' '}
                inherits access from its parent, but your membership
                hasn't been propagated yet. Ask the workspace admin to
                add you to this folder.
              </>
            )}
          </p>

          {selfIdentity && (
            <div className="mt-4 space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Your identity
              </label>
              <div className="flex gap-2">
                <input
                  id="restricted-identity-text"
                  readOnly
                  value={selfIdentity}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCopy}
                  aria-label="Copy identity"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this with the admin so they can add you.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
