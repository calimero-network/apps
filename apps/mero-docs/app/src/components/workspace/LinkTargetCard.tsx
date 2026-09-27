// Card for a routed URL this node can't currently open: a restricted
// folder, a deleted or unknown target, or a workspace it isn't in. Reuses
// RestrictedFolderCard's shell — that card is for a folder still visible in
// the tree but not yet joined; this one is for a link that resolves to
// nothing the caller can see at all.

import { Lock, Home, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyLink } from '@/lib/copyLink';
import type { LinkTarget } from '@/lib/linkTarget';

const RESTRICTED_FOLDER_FALLBACK = 'a restricted folder'; // no alias known for the folder

export type LinkTargetCardKind = Exclude<LinkTarget, 'ok' | 'syncing'>;

interface Props {
  kind: LinkTargetCardKind;
  /** Folder name for the 'no-access' copy; falls back when unknown. */
  folderName?: string | null;
  onGoHome: () => void;
  linkUrl: string;
}

function copyFor(
  kind: LinkTargetCardKind,
  folderName?: string | null,
): { title: string; body: string } {
  switch (kind) {
    case 'no-access': {
      const name = folderName?.trim() || RESTRICTED_FOLDER_FALLBACK;
      return {
        title: `This document is in ${name}`,
        body: 'Ask a folder manager to add you, then open this link again.',
      };
    }
    case 'deleted':
      return {
        title: 'This document was deleted or moved',
        body: "It's no longer at this link.",
      };
    case 'not-in-workspace':
      return {
        title: 'You are not in this workspace',
        body: 'Ask a member of this workspace to send you an invite.',
      };
  }
}

export function LinkTargetCard({ kind, folderName, onGoHome, linkUrl }: Props) {
  const { title, body } = copyFor(kind, folderName);
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
          <Lock className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={onGoHome} className="gap-1.5">
              <Home className="h-3.5 w-3.5" />
              Go to Home
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyLink(linkUrl)}
              className="gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy link
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
