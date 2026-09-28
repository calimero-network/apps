import * as React from 'react';
import { ArrowRight } from 'lucide-react';

import { LivePill } from '@/components/common/LivePill';
import { TagChip } from '@/components/tags/TagChip';
import { TopBarSearch } from '@/components/search/TopBarSearch';
import { SearchPalette, SearchPalettePanel, SearchProgress } from '@/components/search/SearchPalette';
import type { PaletteGroupView } from '@/components/search/types';
import { DOCS, FOLDERS, TAGS, WORKSPACE_NAME } from './mockData';

export const title = 'Search';
export const order = 20;

const EMPTY_TEXT = 'No documents, folders or tags match'; // the palette's no-results line

function tagColor(name: string): string | undefined {
  return TAGS.find((t) => t.name === name)?.color;
}

function Folder({ path }: { path: string[] }) {
  const color = FOLDERS.find((f) => f.name === path[0])?.color ?? undefined;
  return (
    <>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: color }}
      />
      {path.join(' / ')}
    </>
  );
}

function Chip({ name }: { name: string }) {
  return <TagChip name={name} color={tagColor(name)} />;
}

const ARROW = <ArrowRight className="h-3.5 w-3.5" />;

const ROAD_GROUPS: PaletteGroupView[] = [
  {
    id: 'docs',
    label: 'Documents',
    items: [
      {
        id: 'roadmap-2026',
        kind: 'doc',
        title: 'Roadmap 2026',
        titleRanges: [[0, 4]],
        context: (
          <>
            <Folder path={['Product']} /> · <Chip name="roadmap" /> · Yesterday
          </>
        ),
      },
      {
        id: 'q3-launch-plan',
        kind: 'doc',
        title: 'Q3 launch plan',
        context: (
          <>
            <Folder path={['Product']} /> · tag <Chip name="roadmap" /> · 2 min ago
          </>
        ),
        right: <LivePill label="Bob" />,
      },
    ],
  },
  {
    id: 'tags',
    label: 'Tags',
    items: [
      {
        id: 'tag-roadmap',
        kind: 'tag',
        title: '#roadmap',
        titleRanges: [[1, 5]],
        tagColor: tagColor('roadmap'),
        context: '2 documents · show them all on Home',
        right: ARROW,
      },
    ],
  },
  {
    id: 'text',
    label: 'In document text',
    aside: <SearchProgress label="3 of 5 folders searched" />,
    items: [
      {
        id: 'api-spec-v2',
        kind: 'text',
        title: 'API spec v2',
        context: (
          <>
            <Folder path={['Engineering', 'Specs']} /> · in “Versioning”
          </>
        ),
        snippet: '…the public roadmap commits us to one breaking change per year, so v2 has to…',
        snippetRanges: [[12, 16]],
      },
      {
        id: 'launch-blog-post',
        kind: 'text',
        title: 'Launch blog post',
        context: (
          <>
            <Folder path={['Marketing']} /> · in “Draft”
          </>
        ),
        snippet: '…this is the first step on the road to a drive nobody else can read…',
        snippetRanges: [[31, 35]],
      },
    ],
  },
];

const ROAD_WARNING = (
  <>
    <b className="font-semibold">Finance</b> is still syncing, so it was not searched yet.
  </>
);

const RECENT_GROUPS: PaletteGroupView[] = [
  {
    id: 'recent',
    label: 'Recent',
    items: [
      {
        id: 'r1',
        kind: 'recent',
        title: 'Q3 launch plan',
        context: (
          <>
            <Folder path={['Product']} /> · opened 4 min ago
          </>
        ),
        right: <LivePill label="Bob" />,
      },
      {
        id: 'r2',
        kind: 'recent',
        title: 'API spec v2',
        context: (
          <>
            <Folder path={['Engineering', 'Specs']} /> · opened 1 h ago
          </>
        ),
      },
      {
        id: 'r3',
        kind: 'recent',
        title: 'Brand guidelines',
        context: (
          <>
            <Folder path={['Design']} /> · opened yesterday
          </>
        ),
      },
    ],
  },
  {
    id: 'tips',
    label: 'Tips',
    items: [
      {
        id: 'tip-tags',
        kind: 'tip',
        title: 'Type # to search tags only',
        context: (
          <>
            <Chip name="design" />
            <Chip name="roadmap" />
            <Chip name="q3" />
          </>
        ),
      },
    ],
  },
];

const TAG_GROUPS: PaletteGroupView[] = [
  {
    id: 'tags',
    label: 'Tags',
    items: TAGS.map((tag) => {
      const count = DOCS.filter((d) => d.tags.includes(tag.name)).length;
      return {
        id: `tag-${tag.name}`,
        kind: 'tag' as const,
        title: `#${tag.name}`,
        tagColor: tag.color,
        context: `${count} ${count === 1 ? 'document' : 'documents'}`,
        right: ARROW,
      };
    }),
  },
];

function PaletteFrame({
  label,
  initialQuery,
  groups,
  warning,
}: {
  label: string;
  initialQuery: string;
  groups: PaletteGroupView[];
  warning?: React.ReactNode;
}) {
  const [query, setQuery] = React.useState(initialQuery);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <div className="flex w-full max-w-[660px] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xl">
        <SearchPalettePanel
          query={query}
          onQueryChange={setQuery}
          scopeLabel={WORKSPACE_NAME}
          groups={groups}
          warning={warning}
          emptyText={EMPTY_TEXT}
          onOpen={() => {}}
          onClose={() => {}}
        />
      </div>
    </div>
  );
}

export function Gallery(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('road');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Top bar field (an icon below md)</h3>
        <div className="flex h-14 items-center gap-2 border bg-card px-3">
          <span className="shrink-0 text-sm font-semibold">Mero Docs</span>
          <div className="flex min-w-0 flex-1 justify-center md:px-6">
            <TopBarSearch onOpen={() => setOpen(true)} shortcutLabel="⌘K" />
          </div>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">localhost:2428</span>
        </div>
      </div>

      <PaletteFrame label="Results for “road”" initialQuery="road" groups={ROAD_GROUPS} warning={ROAD_WARNING} />
      <PaletteFrame label="Just opened" initialQuery="" groups={RECENT_GROUPS} />
      <PaletteFrame label="Tags only" initialQuery="#" groups={TAG_GROUPS} />
      <PaletteFrame label="No results" initialQuery="zebra" groups={[]} />

      <SearchPalette
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        scopeLabel={WORKSPACE_NAME}
        groups={ROAD_GROUPS}
        warning={ROAD_WARNING}
        emptyText={EMPTY_TEXT}
        onOpen={() => setOpen(false)}
      />
    </div>
  );
}
