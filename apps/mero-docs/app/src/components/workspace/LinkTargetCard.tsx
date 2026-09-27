// Card for a routed URL this node can't open at all. RestrictedFolderCard
// covers a folder still visible in the tree but not yet joined.

import { Lock, FileX2, DoorOpen, Home, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyLink } from '@/lib/copyLink';
import type { LinkTarget } from '@/lib/linkTarget';

const RESTRICTED_FOLDER_FALLBACK = 'a restricted folder'; // no alias known for the folder

export type LinkTargetCardKind = Exclude<LinkTarget, 'ok' | 'syncing'>;

const ICONS = {
  'no-access': Lock,
  deleted: FileX2,
  'not-in-workspace': DoorOpen,
};

interface Props {
  kind: LinkTargetCardKind;
  /** For 'deleted': whether the folder itself is gone, or just the doc in it. */
  deletedKind?: 'folder' | 'doc';
  /** Folder name for the 'no-access' copy; falls back when unknown. */
  folderName?: string | null;
  onGoHome: () => void;
  linkUrl: string;
}

function copyFor(
  kind: LinkTargetCardKind,
  deletedKind: 'folder' | 'doc',
  folderName?: string | null,
): { title: string; body: string } {
  switch (kind) {
    case 'no-access': {
      const name = folderName?.trim();
      const subject = name || 'This folder';
      return {
        title: `This document is in ${name || RESTRICTED_FOLDER_FALLBACK}`,
        body: `${subject} is a restricted folder, and you are not a member yet. Ask a folder manager to add you, then open this link again.`,
      };
    }
    case 'deleted':
      return deletedKind === 'folder'
        ? {
            title: 'This folder was deleted or moved',
            body: "It's no longer at this link.",
          }
        : {
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

export function LinkTargetCard({
  kind,
  deletedKind = 'doc',
  folderName,
  onGoHome,
  linkUrl,
}: Props) {
  const { title, body } = copyFor(kind, deletedKind, folderName);
  const Icon = ICONS[kind];
  return (
    <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
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
