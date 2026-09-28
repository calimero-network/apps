import * as React from 'react';
import {
  CircleAlert,
  ExternalLink,
  FileText,
  FileX2,
  Lock,
  type LucideIcon,
} from 'lucide-react';

import { FolderSwatch } from '@/components/folders/FolderSwatch';
import { Button } from '@/components/ui/button';
import { TagChip } from '@/components/tags/TagChip';
import type { DocTag } from '@/components/tags/DocTagRow';

export type DocLinkCardProps =
  | { state: 'loading' }
  | {
      state: 'ok';
      title: string;
      folderPath: string[];
      folderColor?: string;
      updatedLabel: string;
      excerpt?: string;
      tags: DocTag[];
    }
  | { state: 'unavailable'; onRetry?: () => void }
  | { state: 'deleted' }
  | { state: 'no-access' }
  | { state: 'other-workspace' };

const UNAVAILABLE: Record<
  'unavailable' | 'deleted' | 'no-access' | 'other-workspace',
  [LucideIcon, string]
> = {
  unavailable: [CircleAlert, "Couldn't load this document"],
  deleted: [FileX2, 'This document was deleted'],
  'no-access': [Lock, 'This is in a folder you cannot open'],
  'other-workspace': [ExternalLink, 'This links to another workspace'],
};

const cardClass = 'w-[300px] max-w-[calc(100vw-16px)] px-3.5 py-3';

// What a doc link points at, shown on hover or focus before anyone clicks it.
export function DocLinkCard(props: DocLinkCardProps) {
  if (props.state === 'loading') {
    return (
      <div className={cardClass} aria-busy>
        <span role="status" className="sr-only">
          Loading document…
        </span>
        <div aria-hidden className="space-y-2.5">
          <div className="h-3 w-2/5 rounded bg-secondary" />
          <div className="h-2.5 w-3/5 rounded bg-secondary" />
          <div className="h-2.5 w-full rounded bg-secondary" />
          <div className="h-2.5 w-4/5 rounded bg-secondary" />
        </div>
      </div>
    );
  }

  if (props.state !== 'ok') {
    const [Icon, text] = UNAVAILABLE[props.state];
    return (
      <div
        className={`${cardClass} flex items-center gap-2 text-[13px] text-muted-foreground`}
      >
        <Icon aria-hidden className="h-[15px] w-[15px] shrink-0" />
        <span className="flex-1">{text}</span>
        {props.state === 'unavailable' && props.onRetry && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={props.onRetry}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  const { title, folderPath, folderColor, updatedLabel, excerpt, tags } = props;
  return (
    <div className={cardClass}>
      <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold text-foreground">
        <FileText aria-hidden className="h-[15px] w-[15px] shrink-0" />
        <span className="truncate">{title}</span>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <FolderSwatch color={folderColor} />
        <span className="truncate">
          {folderPath.join(' / ')} · updated {updatedLabel}
        </span>
      </div>
      {excerpt && (
        <p
          data-testid="doc-link-card-excerpt"
          className="mt-2 line-clamp-3 text-xs leading-normal text-muted-foreground"
        >
          {excerpt}
        </p>
      )}
      {tags.length > 0 && (
        <div
          data-testid="doc-link-card-tags"
          className="mt-2.5 flex flex-wrap gap-1"
        >
          {tags.map((tag) => (
            <TagChip key={tag.key} name={tag.name} color={tag.color} />
          ))}
        </div>
      )}
    </div>
  );
}
