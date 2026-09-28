import * as React from 'react';
import { FileText, Folder } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TagChip } from '@/components/tags/TagChip';
import { LivePill } from '@/components/common/LivePill';
import { initials } from '@/components/editor/PeerAvatars';
import type { DocRowView, PersonView, TagView } from './types';

const MAX_TAGS = 3; // the rest collapse into "+N"
const MAX_HERE = 3; // the rest collapse into a "+N" avatar
// Tags and Here now need the room of a wide main pane; narrower panes keep Name, Folder, Updated.
const COLUMNS =
  'md:grid-cols-[minmax(0,1fr)_190px_100px] xl:grid-cols-[minmax(0,1fr)_190px_210px_76px_100px]';

interface Props {
  rows: DocRowView[];
  onOpen: (key: string) => void;
  onOpenInNewTab?: (key: string) => void;
}

export function DocTable({ rows, onOpen, onOpenInNewTab }: Props) {
  const open = (key: string, newTab: boolean) =>
    newTab && onOpenInNewTab ? onOpenInNewTab(key) : onOpen(key);

  return (
    <div className="px-2 md:px-4">
      <div
        aria-hidden
        className={cn(
          'hidden h-[34px] items-center gap-4 border-b border-border/60 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground md:grid',
          COLUMNS,
        )}
      >
        <span>Name</span>
        <span>Folder</span>
        <span className="hidden xl:block">Tags</span>
        <span className="hidden xl:block">Here now</span>
        <span className="text-right">Updated</span>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.key}>
            <div
              role="link"
              tabIndex={0}
              aria-label={row.title || 'Untitled'}
              onClick={(e) => open(row.key, e.metaKey || e.ctrlKey)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                open(row.key, e.metaKey || e.ctrlKey);
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                open(row.key, true);
              }}
              className={cn(
                'flex min-h-[52px] cursor-pointer flex-col justify-center gap-0.5 border-b border-border/60 px-3 py-2 text-[13px] text-secondary-foreground outline-none transition-colors',
                'hover:rounded-md hover:border-transparent hover:bg-accent focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                'md:grid md:h-12 md:min-h-0 md:items-center md:gap-4 md:py-0',
                COLUMNS,
              )}
            >
              <TitleCell row={row} />
              <div className="flex min-w-0 items-center gap-1.5 pl-[25px] text-xs text-muted-foreground md:hidden">
                <FolderPath path={row.folderPath} color={row.folderColor} />
                <span aria-hidden>·</span>
                <span className="shrink-0 tabular-nums">
                  {row.updatedLabel}
                </span>
              </div>
              <div className="hidden min-w-0 items-center gap-[7px] text-[12.5px] text-muted-foreground md:flex">
                <FolderPath path={row.folderPath} color={row.folderColor} />
              </div>
              <TagsCell tags={row.tags} />
              <HereCell here={row.here} />
              <span className="hidden text-right text-xs tabular-nums text-muted-foreground md:block">
                {row.updatedLabel}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TitleCell({ row }: { row: DocRowView }) {
  const muted = row.archived || !row.title;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <FileText
        className="h-[15px] w-[15px] shrink-0 text-muted-foreground/80"
        aria-hidden
      />
      <span
        data-testid="doc-title"
        className={cn(
          'truncate font-medium',
          muted ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {row.title || 'Untitled'}
      </span>
      {row.liveLabel && (
        <span className="shrink-0">
          <LivePill label={row.liveLabel} />
        </span>
      )}
      {row.archived && (
        <span className="shrink-0 rounded border border-border/60 bg-secondary px-1.5 text-[10.5px] font-medium leading-4 text-muted-foreground">
          Archived
        </span>
      )}
    </div>
  );
}

export function FolderPath({ path, color }: { path: string[]; color?: string }) {
  return (
    <>
      {color ? (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border/50"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      ) : (
        <Folder
          className="h-[13px] w-[13px] shrink-0 text-muted-foreground/80"
          aria-hidden
        />
      )}
      <span className="truncate">
        {path.map((segment, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-muted-foreground/60">{' / '}</span>}
            {segment}
          </React.Fragment>
        ))}
      </span>
    </>
  );
}

function TagsCell({ tags }: { tags: TagView[] }) {
  const extra = tags.length - MAX_TAGS;
  return (
    <div className="hidden min-w-0 items-center gap-1 overflow-hidden xl:flex">
      {tags.slice(0, MAX_TAGS).map((t) => (
        <TagChip key={t.key} name={t.name} color={t.color} />
      ))}
      {extra > 0 && (
        <span className="shrink-0 text-[11.5px] text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}

function HereCell({ here }: { here: PersonView[] }) {
  const extra = here.length - MAX_HERE;
  return (
    <div
      className="hidden items-center xl:flex"
      aria-label={
        here.length
          ? `Here now: ${here.map((p) => p.name).join(', ')}`
          : undefined
      }
    >
      {here.slice(0, MAX_HERE).map((p) => (
        <span
          key={p.id}
          className="-ml-[5px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold text-white ring-2 ring-card first:ml-0"
          style={{ backgroundColor: p.colour }}
        >
          {initials(p.name)}
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-[5px] flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-secondary px-1 text-[9.5px] font-semibold text-secondary-foreground ring-2 ring-card">
          +{extra}
        </span>
      )}
    </div>
  );
}
