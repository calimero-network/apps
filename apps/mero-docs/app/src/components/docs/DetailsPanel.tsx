import * as React from 'react';
import { FileText, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { FolderSwatch } from '@/components/folders/FolderSwatch';
import { TagChip } from '@/components/tags/TagChip';
import type { DocTag } from '@/components/tags/DocTagRow';

export interface LinkedFromEntry {
  key: string;
  title: string;
  sentence: string;
  sentenceBold: [number, number][];
  folderPath: string[];
  folderColor?: string;
}

export interface LinksToEntry {
  key: string;
  title: string;
  section?: string;
  folderPath: string[];
  folderColor?: string;
}

export interface DetailsPanelProps {
  folder: { name: string; color?: string };
  created?: { dateLabel: string; by?: React.ReactNode };
  updated?: { relLabel: string; by?: React.ReactNode };
  tags: DocTag[];
  linkedFrom: LinkedFromEntry[];
  linksTo: LinksToEntry[];
  onClose: () => void;
  onOpenLink: (key: string) => void;
}

// Bolds [start, end) runs of the sentence; the caller marks where this document's title sits.
function withBold(text: string, ranges: [number, number][]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  [...ranges]
    .sort((a, b) => a[0] - b[0])
    .forEach(([start, end], i) => {
      const from = Math.max(start, cursor);
      const to = Math.min(end, text.length);
      if (to <= from) return;
      if (from > cursor) nodes.push(text.slice(cursor, from));
      nodes.push(<b key={i}>{text.slice(from, to)}</b>);
      cursor = to;
    });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function Fact({ label, by }: { label: string; by?: React.ReactNode }) {
  return (
    <>
      {label}
      {by && <> by {by}</>}
    </>
  );
}

interface LinkRowProps {
  title: string;
  folderPath: string[];
  folderColor?: string;
  onOpen: () => void;
  children?: React.ReactNode;
}

function LinkRow({
  title,
  folderPath,
  folderColor,
  onOpen,
  children,
}: LinkRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="-mx-1.5 mb-1 block w-[calc(100%+12px)] rounded-[7px] px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center gap-[7px] text-[12.5px] font-medium text-foreground">
        <FileText
          aria-hidden
          className="h-[13px] w-[13px] shrink-0 text-muted-foreground"
        />
        <span className="truncate">{title}</span>
      </span>
      {children && (
        <span className="mt-[3px] block text-[11.5px] leading-[1.45] text-muted-foreground">
          {children}
        </span>
      )}
      <span className="mt-[3px] flex min-w-0 items-center gap-[5px] text-[11px] text-muted-foreground">
        <FolderSwatch color={folderColor} />
        <span className="truncate">{folderPath.join(' / ')}</span>
      </span>
    </button>
  );
}

function LinkSection({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="border-b px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <h3
          id={headingId}
          className="font-semibold uppercase tracking-[0.06em]"
        >
          {title}
        </h3>
        <span data-testid="details-count" className="font-medium">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        children
      )}
    </section>
  );
}

function DetailsBody({
  Title,
  ...props
}: DetailsPanelProps & { Title: React.ElementType }) {
  const {
    folder,
    created,
    updated,
    tags,
    linkedFrom,
    linksTo,
    onClose,
    onOpenLink,
  } = props;
  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b py-3 pl-4 pr-3">
        <Title className="text-[13px] font-semibold text-foreground">
          Details
        </Title>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="Close details"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-x-2.5 gap-y-[7px] border-b px-4 py-3.5 text-[12.5px]">
        <dt className="text-muted-foreground">Folder</dt>
        <dd className="flex min-w-0 items-center gap-1.5 text-secondary-foreground">
          <FolderSwatch color={folder.color} />
          <span className="truncate">{folder.name}</span>
        </dd>
        {created && (
          <>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="min-w-0 text-secondary-foreground">
              <Fact label={created.dateLabel} by={created.by} />
            </dd>
          </>
        )}
        {updated && (
          <>
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="min-w-0 text-secondary-foreground">
              <Fact label={updated.relLabel} by={updated.by} />
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Tags</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1 text-secondary-foreground">
          {tags.length === 0 ? (
            <span className="text-muted-foreground">No tags</span>
          ) : (
            tags.map((tag) => (
              <TagChip key={tag.key} name={tag.name} color={tag.color} />
            ))
          )}
        </dd>
      </dl>
      <LinkSection
        title="Linked from"
        count={linkedFrom.length}
        empty="No documents link here yet"
      >
        {linkedFrom.map((link) => (
          <LinkRow
            key={link.key}
            title={link.title}
            folderPath={link.folderPath}
            folderColor={link.folderColor}
            onOpen={() => onOpenLink(link.key)}
          >
            {withBold(link.sentence, link.sentenceBold)}
          </LinkRow>
        ))}
      </LinkSection>
      <LinkSection
        title="Links to"
        count={linksTo.length}
        empty="This document has no links"
      >
        {linksTo.map((link) => (
          <LinkRow
            key={link.key}
            title={link.title}
            folderPath={link.folderPath}
            folderColor={link.folderColor}
            onOpen={() => onOpenLink(link.key)}
          >
            {link.section && <>Linked in “{link.section}”</>}
          </LinkRow>
        ))}
      </LinkSection>
      <p className="px-4 py-3.5 text-[11.5px] text-muted-foreground">
        Only documents you can open are listed
      </p>
    </>
  );
}

// The document's details beside the editor, from lg up.
export function DetailsPanel(props: DetailsPanelProps) {
  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-l bg-background">
      <DetailsBody Title="h2" {...props} />
    </aside>
  );
}

// The same details as a right-hand sheet below lg; Escape and the backdrop close it.
export function DetailsSheet({
  open,
  ...props
}: DetailsPanelProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="left-auto right-0 top-0 flex h-full max-h-none w-[300px] max-w-[85vw] translate-x-0 translate-y-0 flex-col rounded-none border-y-0 border-r-0 bg-background p-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
      >
        <DetailsBody Title={DialogTitle} {...props} />
      </DialogContent>
    </Dialog>
  );
}
