import * as React from 'react';
import { FileText, Folder, Plus, SearchX, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

type Kind = 'no-folders' | 'no-docs' | 'no-matches';

const COPY: Record<
  Kind,
  {
    icon: LucideIcon;
    title: string;
    body: string;
    action: string;
    primary: boolean;
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
};

interface Props {
  kind: Kind;
  /** Omitted when the viewer cannot take the action (for example, no right to create). */
  onAction?: () => void;
}

export function HomeEmpty({ kind, onAction }: Props) {
  const { icon, title, body, action, primary } = COPY[kind];
  return (
    <EmptyState icon={icon} title={title} body={body}>
      {onAction && (
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
