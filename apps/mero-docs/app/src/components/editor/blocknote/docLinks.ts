// Doc-to-doc links: what the [[ picker offers, what a pick or a pasted app URL
// inserts, and where a click on a link goes. A doc link is an ordinary `link`.

import type { HighlightRange } from '@/components/common/Highlight';
import type { DocLinkPickerItem } from '@/components/editor/DocLinkPickerMenu';
import type { FolderPaths } from '@/components/home/useHomeChips';
import { docLabel } from '@/lib/docLabel';
import { docHref, parseDocHref } from '@/lib/links';
import type { AppRoute } from '@/lib/routes';
import { normalizeQuery } from '@/lib/search/match';
import { searchV1 } from '@/lib/search/rank';
import { searchText } from '@/lib/search/docText';
import {
  rowKey,
  type DocHrefTarget,
  type DocText,
  type IndexRow,
} from '@/lib/workspaceIndex/types';
import type { DriveEditor } from './schema';

export const DOC_LINK_TRIGGER = '['; // the second [ of [[ opens the picker
const PICK_LIMIT = 5; // rows per picker group, so the menu fits under the caret
const NEW_TAB = '_blank'; // window.open target for a new tab
const MIDDLE_BUTTON = 1; // MouseEvent.button; 2 is the context-menu button

export type DocLinkItem = DocLinkPickerItem & { href: string };
export type DocLink = { href: string; title: string };

type Textish = {
  doc: { textBetween(from: number, to: number): string };
  selection: { from: number };
};

/** True when the [ being typed follows another, so [[ opens the picker and a lone [ stays text. */
export function opensDocPicker(tr: Textish): boolean {
  const at = tr.selection.from;
  return at > 0 && tr.doc.textBetween(at - 1, at) === DOC_LINK_TRIGGER;
}

const toRanges = (ranges: [number, number][]): HighlightRange[] =>
  ranges.map(([start, end]) => ({ start, end }));

type PickerSource = {
  ws: string;
  current?: { folder?: string; doc?: string };
  rows: IndexRow[];
  texts: Map<string, DocText>;
  paths: FolderPaths;
};

/** Docs whose title matches, then docs whose text matches (linked to that block); recent docs for an empty query. */
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
    return [...live.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, PICK_LIMIT)
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

/** Puts `title` linked to `href` at the caret, taking the [ the picker leaves behind. */
export function insertDocLink(editor: DriveEditor, link: DocLink): void {
  editor.transact((tr) => {
    if (opensDocPicker(tr)) tr.delete(tr.selection.from - 1, tr.selection.from);
    editor.insertInlineContent(
      [{ type: 'link', href: link.href, content: link.title }],
      { updateSelection: true },
    );
  });
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
