// Mentioning a workspace member from the @ picker. A mention is an ordinary
// `link` whose href names the member, so it saves like a doc link.

import { listedPersonName } from '@/hooks/usePersonName';
import { nameCollator } from '@/lib/collate';
import { memberHref } from '@/lib/links';
import {
  foldForSearch,
  matchRanges,
  matchScore,
  normalizeQuery,
  queryWords,
  TYPO_TIER,
  typoFallback,
} from '@/lib/search/match';
import type { DocText, IndexRow } from '@/lib/workspaceIndex/types';
import {
  docLinkItems,
  insertDocLink,
  PICK_LIMIT,
  type DocLinkItem,
} from './docLinks';
import type { DriveEditor } from './schema';

export const PEOPLE_GROUP = 'People';
export const CANT_OPEN_FOLDER = "Can't open this folder";

type PeopleSource = {
  ws: string;
  self: string | null;
  members: string[];
  names: Record<string, string>; // member id -> display name, as usePersonName reads them
  workedWith: string[]; // member ids to offer first, best first
  canOpen: (member: string) => boolean | undefined; // undefined while unknown
};

/** Members whose name matches, best first; before anything is typed, the people in `workedWith` first and you last. */
export function peopleItems(query: string, src: PeopleSource): DocLinkItem[] {
  const { text } = normalizeQuery(query);
  const words = queryWords(text);
  const rank = new Map(src.workedWith.map((id, i) => [id, i]));
  const ranked = src.members.flatMap((id) => {
    const title = listedPersonName(id, src.self, src.names);
    const name = listedPersonName(id, null, src.names);
    const scores = [title, name].map((s) =>
      matchScore(foldForSearch(s), words),
    );
    const score = Math.min(...scores.map((s) => s ?? Infinity));
    if (score === Infinity) return [];
    const cantOpen = src.canOpen(id) === false;
    const item: DocLinkItem = {
      id: `person:${id}`,
      kind: 'person',
      group: PEOPLE_GROUP,
      title,
      titleRanges: matchRanges(title, text).map(([start, end]) => ({
        start,
        end,
      })),
      folderLabel: cantOpen ? CANT_OPEN_FOLDER : '',
      href: memberHref({ ws: src.ws, member: id }),
      mention: { name, cantOpen },
      typo: score >= TYPO_TIER,
    };
    const order = id === src.self ? Infinity : rank.get(id) ?? rank.size;
    return [{ score, order, item }];
  });
  return ranked
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.order - b.order ||
        nameCollator.compare(a.item.title, b.item.title),
    )
    .slice(0, PICK_LIMIT)
    .map(({ item }) => item);
}

/** Who to offer first: members mentioned in the open doc, people in it now, then authors of recently updated docs. */
export function recentPeople(
  current: string | undefined,
  texts: Map<string, DocText>,
  present: string[],
  rows: IndexRow[],
): string[] {
  const mentioned = current
    ? texts.get(current)?.mentions.map((m) => m.member) ?? []
    : [];
  const authors = [...rows]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((r) => [r.updatedBy, r.createdBy]);
  return [...new Set([...mentioned, ...present, ...authors])];
}

/** The @ menu: people to mention, then documents to link. */
export function mentionPickerItems(
  query: string,
  src: PeopleSource & Parameters<typeof docLinkItems>[1],
): DocLinkItem[] {
  return typoFallback([
    ...peopleItems(query, src),
    ...docLinkItems(query, src),
  ]);
}

/** Inserts a picked row: the member's name linked to them, or a doc's title; says so when the member cannot open this folder. */
export function pickLinkItem(
  editor: DriveEditor,
  item: DocLinkItem,
  notify: (message: string) => void,
): void {
  const { mention } = item;
  insertDocLink(editor, {
    href: item.href,
    title: mention ? mention.name : item.title,
  });
  if (mention?.cantOpen) notify(`${mention.name} can't open this folder`);
}
