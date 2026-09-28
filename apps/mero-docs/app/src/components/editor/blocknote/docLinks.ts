// Doc-to-doc links: what the @ picker offers, what a pick or a pasted app URL
// inserts, and where a click on a link goes. A doc link is an ordinary `link`.

import type { HighlightRange } from '@/components/common/Highlight';
import type { DocLinkPickerItem } from '@/components/editor/DocLinkPickerMenu';
import type { FolderPaths } from '@/components/home/useHomeChips';
import type { RecentDoc } from '@/hooks/useRecentDocs';
import { docLabel } from '@/lib/docLabel';
import { docHref, parseDocHref } from '@/lib/links';
import type { AppRoute } from '@/lib/routes';
import {
  foldForSearch,
  matchRanges,
  matchScore,
  normalizeQuery,
} from '@/lib/search/match';
import { searchV1 } from '@/lib/search/rank';
import { HEADING_KIND, searchText } from '@/lib/search/docText';
import {
  rowKey,
  type DocHrefTarget,
  type DocText,
  type IndexRow,
} from '@/lib/workspaceIndex/types';
import type { DriveEditor } from './schema';

export const DOC_LINK_TRIGGER = '@'; // opens the picker at a word start
const WORD_START = /^\s?$/; // what may precede the trigger: nothing, or whitespace
const PICK_LIMIT = 5; // rows per picker group, so the menu fits under the caret
const START_LIMIT = 8; // rows before anything is typed
const TITLE_ONLY_RANK = 3; // past any heading match score, so those rank first
const NEW_TAB = '_blank'; // window.open target for a new tab
const MIDDLE_BUTTON = 1; // MouseEvent.button; 2 is the context-menu button

export type DocLinkItem = DocLinkPickerItem & { href: string };
export type DocLink = { href: string; title: string };

type Textish = {
  doc: { textBetween(from: number, to: number): string };
  selection: { from: number };
};

/** True when the @ being typed starts a word, so an email address stays text. */
export function opensDocPicker(tr: Textish): boolean {
  const at = tr.selection.from;
  return WORD_START.test(tr.doc.textBetween(Math.max(0, at - 1), at));
}

const toRanges = (ranges: [number, number][]): HighlightRange[] =>
  ranges.map(([start, end]) => ({ start, end }));

type PickerSource = {
  ws: string;
  current?: { folder?: string; doc?: string };
  rows: IndexRow[];
  texts: Map<string, DocText>;
  paths: FolderPaths;
  recent?: RecentDoc[];
};

/** Docs whose title matches, then docs whose text matches (linked to that block); for an empty query, titled docs opened lately, then by last update. */
export function docLinkItems(query: string, src: PickerSource): DocLinkItem[] {
  const live = new Map(
    src.rows
      .filter(
        (r) =>
          !r.archived &&
          !(r.folderId === src.current?.folder && r.docId === src.current?.doc),
      )
      .map((r) => [rowKey(r.folderId, r.docId), r]),
  );
  const item = (
    r: IndexRow,
    kind: DocLinkItem['kind'],
    block?: string,
  ): DocLinkItem => ({
    id: `${kind}:${rowKey(r.folderId, r.docId)}`,
    kind,
    title: docLabel(r.title),
    folderLabel: src.paths.get(r.folderId)?.names.join(' / ') ?? '',
    href: docHref({ ws: src.ws, folder: r.folderId, doc: r.docId, block }),
  });

  if (!normalizeQuery(query).text) {
    const opened = (src.recent ?? []).flatMap((e) => {
      const r = live.get(rowKey(e.folderId, e.docId));
      return r ? [r] : [];
    });
    const updated = [...live.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    return [...new Set([...opened, ...updated])]
      .filter((r) => r.title.trim())
      .slice(0, START_LIMIT)
      .map((r) => item(r, 'doc'));
  }
  const titles = searchV1(query, [...live.values()], [], [], {
    docs: PICK_LIMIT,
    folders: 0,
    tags: 0,
  }).flatMap((hit) =>
    hit.kind === 'doc'
      ? [{ ...item(hit.row, 'doc'), titleRanges: toRanges(hit.ranges) }]
      : [],
  );
  const texts = searchText(query, src.texts).flatMap((hit) => {
    const r = live.get(hit.row);
    if (!r) return [];
    return [
      {
        ...item(r, 'text', hit.blockId),
        quote: hit.snippet,
        quoteRanges: toRanges(hit.ranges),
      },
    ];
  });
  return [...titles, ...texts.slice(0, PICK_LIMIT)];
}

/** Headings to link to, the open doc's first and then by last update; a query matches the heading or its doc's title. */
export function sectionLinkItems(
  query: string,
  src: PickerSource,
): DocLinkItem[] {
  const { text } = normalizeQuery(query);
  const q = foldForSearch(text);
  const isOpen = (r: IndexRow) =>
    r.folderId === src.current?.folder && r.docId === src.current?.doc;
  const docs = src.rows
    .filter((r) => !r.archived)
    .sort(
      (a, b) =>
        Number(isOpen(b)) - Number(isOpen(a)) || b.updatedAt - a.updatedAt,
    );
  const ranked = docs.flatMap((r) => {
    const title = docLabel(r.title);
    const titleScore = q ? matchScore(foldForSearch(title), q) : 0;
    const blocks = src.texts.get(rowKey(r.folderId, r.docId))?.blocks ?? [];
    return blocks.flatMap((b) => {
      const heading = b.text.trim();
      if (b.kind !== HEADING_KIND || !heading) return [];
      const score = q ? matchScore(foldForSearch(heading), q) : 0;
      const rank =
        score ?? (titleScore === null ? null : titleScore + TITLE_ONLY_RANK);
      if (rank === null) return [];
      const item: DocLinkItem = {
        id: `section:${rowKey(r.folderId, r.docId)}:${b.id}`,
        kind: 'section',
        title: heading,
        titleRanges: toRanges(matchRanges(heading, text)),
        folderLabel: title,
        href: docHref({
          ws: src.ws,
          folder: r.folderId,
          doc: r.docId,
          block: b.id,
        }),
      };
      return [{ rank, item }];
    });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, START_LIMIT)
    .map(({ item }) => item);
}

/** Puts `title` linked to `href` at the caret. */
export function insertDocLink(editor: DriveEditor, link: DocLink): void {
  editor.insertInlineContent(
    [{ type: 'link', href: link.href, content: link.title }],
    { updateSelection: true },
  );
}

/** A pasted doc URL from this workspace as a link titled with the doc; anything else is null. */
export function pastedDocLink(
  text: string,
  ctx: Pick<LinkNav, 'origin' | 'ws'> & {
    rows: ReadonlyMap<string, IndexRow>;
  },
): DocLink | null {
  const url = text.trim();
  if (!url || /\s/.test(url)) return null;
  const target = parseDocHref(url, ctx.origin);
  if (!target || !ctx.ws || target.ws !== ctx.ws) return null;
  const row = ctx.rows.get(rowKey(target.folder, target.doc));
  return { href: docHref(target), title: row ? docLabel(row.title) : url };
}

export type LinkNav = {
  origin: string;
  ws: string | undefined;
  goDoc: (folder: string, doc: string, opts: { block?: string }) => void;
  navigate: (path: string) => void;
  href: (route: AppRoute) => string;
};

/** What the editor's click and paste handlers read: navigation plus the index rows by rowKey. */
export type EditorLinkNav = LinkNav & { rows: ReadonlyMap<string, IndexRow> };

function anchorAt(el: EventTarget | null): HTMLAnchorElement | null {
  return el instanceof Element
    ? el.closest<HTMLAnchorElement>('a[href]')
    : null;
}

/** The doc link an element is part of, with what it points at; null inside any other link or none. */
export function docLinkAt(
  el: EventTarget | null,
  origin: string,
): { anchor: HTMLAnchorElement; target: DocHrefTarget } | null {
  const anchor = anchorAt(el);
  const href = anchor?.getAttribute('href');
  const target = href ? parseDocHref(href, origin) : null;
  return anchor && target ? { anchor, target } : null;
}

/** Opens a clicked doc link inside the app, or in a new tab on a modified or middle click; false for any other link or button. */
export function followDocLink(event: MouseEvent, nav: LinkNav): boolean {
  const target = docLinkAt(event.target, nav.origin)?.target;
  if (!target || event.button > MIDDLE_BUTTON) return false;
  event.preventDefault();
  if (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.button === MIDDLE_BUTTON
  ) {
    window.open(nav.href(target), NEW_TAB, 'noopener');
  } else if (target.ws === nav.ws) {
    nav.goDoc(target.folder, target.doc, { block: target.block });
  } else {
    nav.navigate(nav.href(target));
  }
  return true;
}

/** The editor's link click: a doc link as above, any other link in a new tab as BlockNote would. */
export function openClickedLink(event: MouseEvent, nav: LinkNav): true {
  if (!followDocLink(event, nav)) {
    const anchor = anchorAt(event.target);
    if (anchor) window.open(anchor.href, NEW_TAB, 'noopener');
  }
  return true;
}
