import * as React from 'react';
import {
  FileText,
  Folder,
  Plus,
  SearchX,
  Tag,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

type Kind = 'no-folders' | 'no-docs' | 'no-matches' | 'no-tagged' | 'partial';

const COPY: Record<
  Kind,
  {
    icon: LucideIcon;
    title: string;
    body: string;
    action?: string; // none: nothing on this screen fixes it
    primary?: boolean;
  }
> = {
  'no-folders': {
    icon: Folder,
    title: 'No folders yet',
    body: 'Documents live in folders. Create the first one to get started.',
    action: 'New folder',
    primary: true,
  },
  'no-docs': {
    icon: FileText,
    title: 'No documents yet',
    body: 'Documents you can open, in every folder, show up here.',
    action: 'New document',
    primary: true,
  },
  'no-matches': {
    icon: SearchX,
    title: 'No documents match these filters',
    body: 'Remove a filter to see more.',
    action: 'Clear filters',
    primary: false,
  },
  'no-tagged': {
    icon: Tag,
    title: 'No documents have this tag yet',
    body: 'Add it from the Tags row at the top of a document.',
  },
  partial: {
    icon: SearchX,
    title: 'No matches in the documents read so far',
    body: 'Some documents could not be read, so this list may be incomplete.',
  },
};

interface Props {
  kind: Kind;
  /** Omitted when the viewer cannot take the action (for example, no right to create). */
  onAction?: () => void;
  body?: string | null; // replaces the default copy; null while it is not known yet
}

export function HomeEmpty({ kind, onAction, body }: Props) {
  const copy = COPY[kind];
  const { icon, title, action, primary } = copy;
  return (
    <EmptyState
      icon={icon}
      title={title}
      body={body === undefined ? copy.body : body ?? undefined}
    >
      {onAction && action && (
        <Button
          variant={primary ? 'default' : 'outline'}
          size="sm"
          onClick={onAction}
        >
          {primary && <Plus />}
          {action}
        </Button>
      )}
    </EmptyState>
  );
}
