import {
  rowKey,
  type DocHrefTarget,
  type DocText,
} from './workspaceIndex/types';

export type Backlink = {
  row: string;
  sentence: string;
  sentenceBold: [number, number][];
};

function sameDoc(t: DocHrefTarget, folder: string, doc: string): boolean {
  return t.folder === folder && t.doc === doc;
}

/** Docs in `texts` that link to `target`, one per doc, with the sentence of its first link. */
export function backlinksTo(
  target: { ws: string; folder: string; doc: string },
  texts: Map<string, DocText>,
): Backlink[] {
  const out: Backlink[] = [];
  for (const text of texts.values()) {
    if (text.folderId === target.folder && text.docId === target.doc) continue;
    const link = text.links.find(
      (l) =>
        l.target.ws === target.ws &&
        sameDoc(l.target, target.folder, target.doc),
    );
    if (!link) continue;
    const [from, to] = link.linkRange;
    out.push({
      row: rowKey(text.folderId, text.docId),
      sentence: link.sentence,
      sentenceBold: from < to ? [link.linkRange] : [],
    });
  }
  return out;
}

/** The other docs `text` links to, once each in document order, with the first link's section. */
export function linksFrom(
  text: DocText,
): { target: DocHrefTarget; section?: string }[] {
  const seen = new Set<string>();
  const out: { target: DocHrefTarget; section?: string }[] = [];
  for (const { target, section } of text.links) {
    const key = JSON.stringify([target.ws, target.folder, target.doc]);
    if (sameDoc(target, text.folderId, text.docId) || seen.has(key)) continue;
    seen.add(key);
    out.push(section === undefined ? { target } : { target, section });
  }
  return out;
}
