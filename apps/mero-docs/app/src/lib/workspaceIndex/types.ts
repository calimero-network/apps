const NS_PER_MS = 1_000_000; // the node stamps docs in nanoseconds

/** One doc in the workspace index; timestamps are milliseconds. */
export type IndexRow = {
  folderId: string;
  docId: string;
  title: string;
  tags: string[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
};

export type FolderInfo = {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
};

export type Tag = {
  key: string;
  name: string;
  color: string;
  deleted: boolean;
};

export type DocHrefTarget = {
  ws: string;
  folder: string;
  doc: string;
  block?: string;
};

/** A doc's searchable text; `linkRange` is the link text's span inside `sentence`. */
export type DocText = {
  folderId: string;
  docId: string;
  blocks: { id: string; kind: string; text: string; heading?: string }[];
  links: {
    target: DocHrefTarget;
    blockId: string;
    sentence: string;
    linkRange: [number, number];
    section?: string;
  }[];
};

export const rowKey = (folderId: string, docId: string) =>
  `${folderId}/${docId}`;

export function nsToMs(ns: number): number {
  return Math.floor(ns / NS_PER_MS);
}
