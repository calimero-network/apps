import * as React from 'react';
import {
  ChevronLeft,
  FileText,
  Link,
  MoreHorizontal,
  PanelRight,
  Redo2,
  Undo2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EditorStatusBar } from '@/components/editor/EditorStatusBar';
import { SectionBanner } from '@/components/editor/SectionBanner';
import {
  DocLinkCard,
  type DocLinkCardProps,
} from '@/components/editor/DocLinkCard';
import {
  DocLinkPickerMenu,
  type DocLinkPickerItem,
} from '@/components/editor/DocLinkPickerMenu';
import {
  DetailsPanel,
  DetailsSheet,
  type DetailsPanelProps,
} from '@/components/docs/DetailsPanel';
import { DocTagRow, type DocTag } from '@/components/tags/DocTagRow';
import { AddTagPopover } from '@/components/tags/AddTagPopover';
import { TAG_COLORS } from '@/lib/tags';
import { DOCS, FOLDERS, TAGS } from './mockData';

export const title = 'Editor';
export const order = 30;

const DOC = DOCS[0]; // Q3 launch plan
const MD_QUERY = '(min-width: 768px)'; // Tailwind md, where Details docks beside the document

const tag = (name: string) => ({
  key: name,
  name,
  color: TAGS.find((t) => t.name === name)?.color,
});
const folderColor = (name: string) =>
  FOLDERS.find((f) => f.name === name)?.color ?? undefined;
const stopNavigation = (event: React.MouseEvent) => event.preventDefault();

function HeaderMock({
  detailsOn,
  onDetails,
}: {
  detailsOn?: boolean;
  onDetails?: () => void;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 gap-1.5"
        aria-label="Back to Product"
      >
        <ChevronLeft className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Product</span>
      </Button>
      <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-4 text-sm font-medium">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{DOC.title}</span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label="Copy link"
        >
          <Link className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Copy link</span>
        </Button>
        <Button
          variant={detailsOn ? 'selected' : 'ghost'}
          size="icon"
          className="h-9 w-9"
          aria-label="Details"
          aria-pressed={!!detailsOn}
          onClick={onDetails}
        >
          <PanelRight />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden h-9 w-9 sm:inline-flex"
          aria-label="Undo"
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden h-9 w-9 sm:inline-flex"
          aria-label="Redo"
        >
          <Redo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="Document actions"
        >
          <MoreHorizontal />
        </Button>
      </div>
    </header>
  );
}

function DocLinks() {
  return (
    <>
      Pricing follows the model in{' '}
      <a href="/app/acme-product/f/product/d/doc-7" onClick={stopNavigation}>
        Pricing notes
      </a>
      , and the launch story lives in{' '}
      <a href="/app/acme-product/f/marketing/d/doc-5" onClick={stopNavigation}>
        Launch blog post
      </a>
      . Background:{' '}
      <a href="https://example.com/p2p-pricing" onClick={stopNavigation}>
        peer-to-peer pricing
      </a>
      .
    </>
  );
}

interface DocBodyProps {
  tagRow?: React.ReactNode;
  headingClass?: string;
  linkLine?: React.ReactNode;
  afterLinks?: React.ReactNode;
}

// A static stand-in for the BlockNote document, laid out like EditorShell's column.
function DocBody({
  tagRow,
  headingClass = '',
  linkLine,
  afterLinks,
}: DocBodyProps) {
  return (
    <div className="mx-auto max-w-4xl px-8 py-6 md:px-16 lg:px-24">
      {tagRow}
      <div className="bn-editor text-[15px] leading-[1.65] text-secondary-foreground">
        <p className="mb-3">
          We ship the collaborative editor to every workspace by the end of the
          quarter. Every document stays end-to-end encrypted and syncs peer to
          peer.
        </p>
        <h2
          className={`mb-2.5 mt-[22px] text-[26px] font-bold tracking-[-0.02em] text-foreground ${headingClass}`}
        >
          Milestones
        </h2>
        <ul className="mb-3 list-disc pl-[22px] leading-[1.75]">
          <li>Folder sharing and roles</li>
          <li>Live presence and remote carets</li>
          <li>Offline editing with conflict-free merge</li>
        </ul>
        <p className="mb-3">{linkLine ?? <DocLinks />}</p>
        {afterLinks}
        <h2 className="mb-2.5 mt-[22px] text-[26px] font-bold tracking-[-0.02em] text-foreground">
          Open questions
        </h2>
        <ul className="list-disc pl-[22px] leading-[1.75]">
          <li>Do restricted folders need an audit trail in v1?</li>
          <li>Default capabilities for invited members</li>
        </ul>
      </div>
    </div>
  );
}

function EditorFrame({
  children,
  height = 'h-[600px]',
}: {
  children: React.ReactNode;
  height?: string;
}) {
  return (
    <TooltipProvider>
      <div
        className={`flex ${height} flex-col overflow-hidden rounded-lg border bg-background`}
      >
        {children}
      </div>
    </TooltipProvider>
  );
}

function StatusBar() {
  return (
    <EditorStatusBar
      documentName={DOC.title}
      wordCount={55}
      charCount={351}
      saveStatus="saved"
      lastSavedAt={new Date(2026, 8, 28, 11, 35)}
    />
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-sm font-medium text-muted-foreground">
      {children}
    </h3>
  );
}

function TagsFrame() {
  const [open, setOpen] = React.useState(true);
  const [query, setQuery] = React.useState('lau');
  const [color, setColor] = React.useState<string>(TAG_COLORS[3]);
  const [tags, setTags] = React.useState<DocTag[]>(() => DOC.tags.map(tag));
  const suggestions = TAGS.filter(
    (t) =>
      t.name.includes(query.trim().toLowerCase()) &&
      !tags.some((d) => d.key === t.name),
  ).map((t) => ({
    key: t.name,
    name: t.name,
    color: t.color,
    countLabel: `${DOCS.filter((d) => d.tags.includes(t.name)).length} doc`,
  }));
  const trimmed = query.trim();
  const canCreate =
    trimmed !== '' && !TAGS.some((t) => t.name === trimmed.toLowerCase());
  const add = (next: { key: string; name: string; color?: string }) => {
    setTags((current) => [...current, next]);
    setQuery('');
    setOpen(false);
  };

  return (
    <EditorFrame>
      <HeaderMock />
      <div className="flex-1 overflow-y-auto bg-card">
        <DocBody
          tagRow={
            <DocTagRow
              tags={tags}
              canEdit
              onRemove={(key) =>
                setTags((current) => current.filter((t) => t.key !== key))
              }
              addTrigger={
                <AddTagPopover
                  open={open}
                  onOpenChange={setOpen}
                  query={query}
                  onQueryChange={setQuery}
                  suggestions={suggestions}
                  canCreate={canCreate}
                  createLabel={trimmed}
                  color={color}
                  onColorChange={setColor}
                  onPick={(key) => add(tag(key))}
                  onCreate={() => add({ key: trimmed, name: trimmed, color })}
                />
              }
            />
          }
        />
      </div>
      <StatusBar />
    </EditorFrame>
  );
}

function OpenedFrame() {
  const [washKey, setWashKey] = React.useState(0);
  return (
    <>
      <EditorFrame height="h-[520px]">
        <HeaderMock />
        <SectionBanner
          variant="opened"
          section="Milestones"
          onTop={() => {}}
          onDismiss={() => {}}
        />
        <div className="flex-1 overflow-y-auto bg-card">
          <DocBody
            tagRow={
              <DocTagRow
                tags={DOC.tags.map(tag)}
                canEdit={false}
                onRemove={() => {}}
                addTrigger={null}
              />
            }
            headingClass="section-wash"
            key={washKey}
          />
        </div>
        <StatusBar />
      </EditorFrame>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => setWashKey((k) => k + 1)}
      >
        Replay wash
      </Button>
    </>
  );
}

const CARD_STATES: DocLinkCardProps[] = [
  {
    state: 'ok',
    title: 'Pricing notes',
    folderPath: ['Product'],
    folderColor: folderColor('Product'),
    updatedLabel: 'Sep 20 by You',
    excerpt:
      'Seat-based pricing does not fit a peer-to-peer product. Three options below, with the one we prefer first. The third option only works once billing supports teams, which is not before Q1.',
    tags: [tag('pricing')],
  },
  { state: 'loading' },
  { state: 'deleted' },
  { state: 'no-access' },
  { state: 'other-workspace' },
];

const PICKER_ITEMS: DocLinkPickerItem[] = [
  {
    id: 'doc-7',
    kind: 'doc',
    title: 'Pricing notes',
    titleRanges: [{ start: 0, end: 4 }],
    folderLabel: 'Product',
  },
  {
    id: 'doc-6',
    kind: 'text',
    title: 'Design review notes',
    quote: 'Pricing page',
    quoteRanges: [{ start: 0, end: 4 }],
    folderLabel: 'Design',
  },
  {
    id: 'doc-5',
    kind: 'text',
    title: 'Launch blog post',
    quote: 'Pricing',
    quoteRanges: [{ start: 0, end: 4 }],
    folderLabel: 'Marketing',
  },
];

const DETAILS: Omit<DetailsPanelProps, 'onClose'> = {
  folder: { name: 'Product', color: folderColor('Product') },
  created: { dateLabel: 'Sep 3', by: 'You' },
  updated: { relLabel: DOC.updatedLabel, by: DOC.updatedBy },
  tags: DOC.tags.map(tag),
  linkedFrom: [
    {
      key: 'doc-4',
      title: 'Roadmap 2026',
      sentence: '…the H2 work depends on Q3 launch plan landing first…',
      sentenceBold: [[24, 38]],
      folderPath: ['Product'],
      folderColor: folderColor('Product'),
    },
    {
      key: 'doc-5',
      title: 'Launch blog post',
      sentence: '…dates come from Q3 launch plan, section Milestones…',
      sentenceBold: [[17, 31]],
      folderPath: ['Marketing'],
      folderColor: folderColor('Marketing'),
    },
    {
      key: 'doc-6',
      title: 'Design review notes',
      sentence: '…see Q3 launch plan for scope…',
      sentenceBold: [[5, 19]],
      folderPath: ['Design'],
      folderColor: folderColor('Design'),
    },
  ],
  linksTo: [
    {
      key: 'doc-7',
      title: 'Pricing notes',
      section: 'Milestones',
      folderPath: ['Product'],
      folderColor: folderColor('Product'),
    },
    {
      key: 'doc-5',
      title: 'Launch blog post',
      section: 'Milestones',
      folderPath: ['Marketing'],
      folderColor: folderColor('Marketing'),
    },
  ],
  onOpenLink: () => {},
};

function DetailsFrame() {
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const toggle = () =>
    window.matchMedia(MD_QUERY).matches
      ? setPanelOpen((o) => !o)
      : setSheetOpen(true);

  return (
    <EditorFrame height="h-[720px]">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <HeaderMock detailsOn={panelOpen || sheetOpen} onDetails={toggle} />
          <div className="flex-1 overflow-y-auto bg-card">
            <DocBody
              tagRow={
                <DocTagRow
                  tags={DOC.tags.map(tag)}
                  canEdit={false}
                  onRemove={() => {}}
                  addTrigger={null}
                />
              }
            />
          </div>
          <StatusBar />
        </div>
        {panelOpen && (
          <div className="hidden md:flex">
            <DetailsPanel {...DETAILS} onClose={() => setPanelOpen(false)} />
          </div>
        )}
      </div>
      <DetailsSheet
        {...DETAILS}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </EditorFrame>
  );
}

export function Gallery(): React.JSX.Element {
  return (
    <div className="space-y-10">
      <div>
        <Caption>Tags with Add tag open on “lau”</Caption>
        <TagsFrame />
      </div>

      <div>
        <Caption>Opened from a section link</Caption>
        <OpenedFrame />
      </div>

      <div>
        <Caption>Section link whose section was removed</Caption>
        <EditorFrame height="h-auto">
          <HeaderMock />
          <SectionBanner variant="missing" onDismiss={() => {}} />
        </EditorFrame>
      </div>

      <div>
        <Caption>Doc link chips beside an external link</Caption>
        <div className="rounded-lg border bg-card px-8 py-6">
          <p className="bn-editor text-[15px] leading-[1.65] text-secondary-foreground">
            <DocLinks />
          </p>
        </div>
      </div>

      <div>
        <Caption>Doc link hover card</Caption>
        <div className="flex flex-wrap items-start gap-4">
          {CARD_STATES.map((card) => (
            <div
              key={card.state}
              className="rounded-[10px] border bg-popover text-popover-foreground shadow-md"
            >
              <DocLinkCard {...card} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <Caption>Link picker under “[[pric”</Caption>
        <EditorFrame height="h-[520px]">
          <HeaderMock />
          <div className="flex-1 overflow-y-auto bg-card">
            <DocBody
              linkLine={
                <>
                  Pricing follows the model in{' '}
                  <span className="rounded-[3px] bg-secondary px-0.5 text-foreground">
                    [[pric
                  </span>
                </>
              }
              afterLinks={
                <div className="mb-3 space-y-3">
                  <DocLinkPickerMenu
                    items={PICKER_ITEMS}
                    activeIndex={0}
                    onPick={() => {}}
                  />
                  <DocLinkPickerMenu
                    items={[]}
                    activeIndex={0}
                    onPick={() => {}}
                  />
                </div>
              }
            />
          </div>
          <StatusBar />
        </EditorFrame>
      </div>

      <div>
        <Caption>Details beside the document (a sheet below md)</Caption>
        <DetailsFrame />
      </div>
    </div>
  );
}
