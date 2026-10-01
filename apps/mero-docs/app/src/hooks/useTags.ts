// The workspace's tags: each doc carries only keys, and the registry maps a key
// to its name and colour, so one read here names every tag chip in the app.

import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import type { DocsClient } from '@/generated/docs/DocsClient';
import type { RegistryClient } from '@/generated/registry/RegistryClient';
import {
  findTagByName,
  normalizeTagName,
  tagKeyFor,
  type Tag,
} from '@/lib/tags';
import { settleInPool } from '@/lib/pool';
import type { IndexRow } from '@/lib/workspaceIndex/types';
import { notifyDocsRefetch } from './useDocs';
import { useDriveWorkspace } from './useDriveWorkspace';
import { useNamespacePermissions } from './useNamespacePermissions';
import { useRegistryRead } from './useRegistryRead';

const FIRST_READ_TRIES = 3; // a just-opened workspace's registry may not answer yet
export const TAG_NAME_TAKEN = 'A tag with this name already exists';
const SAVE_FAILED = "Couldn't save the tag. Try again.";
const DELETE_FAILED = "Couldn't delete the tag. Try again.";
const TAG_DELETED = 'This tag has been deleted.';
const UNTAG_IN_FLIGHT = 4; // docs untagged at once while a tag is deleted

export class TagNameTakenError extends Error {
  constructor() {
    super(TAG_NAME_TAKEN);
    this.name = 'TagNameTakenError';
  }
}

export type TagsState = {
  tags: Tag[];
  byKey: Map<string, Tag>;
  /** The key of the live tag with this name, created if there is none. */
  createTag(name: string, color: string): Promise<string>;
  renameTag(key: string, name: string): Promise<void>;
  recolorTag(key: string, color: string): Promise<void>;
  /** Strips the tag from the docs in `editable` folders, then marks it deleted everywhere. */
  deleteTag(key: string, editable: ReadonlySet<string>): Promise<void>;
};

type IndexSource = {
  rows: IndexRow[];
  contextOf(folderId: string): string | undefined;
  clientOf(folderId: string): DocsClient | undefined;
};

const notReady = () => Promise.reject(new Error('tags are not ready'));

export const TagsContext = createContext<TagsState>({
  tags: [],
  byKey: new Map(),
  createTag: notReady,
  renameTag: notReady,
  recolorTag: notReady,
  deleteTag: notReady,
});

/** The shared tag list and its writes, from the workspace provider. */
export function useTags(): TagsState {
  return useContext(TagsContext);
}

/** Editors and above manage tags; a Guest holds no workspace caps, so cannot create folders either. */
export function useCanManageTags(): boolean {
  const { namespaceId, rootGroupId } = useDriveWorkspace();
  return useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '')
    .canCreateFolder;
}

/** Reads the tags and re-reads on registry changes; a failed re-read keeps the last list. */
export function useTagsSource(index: IndexSource): TagsState {
  const { registryClient } = useDriveWorkspace();
  const indexRef = useRef(index);
  indexRef.current = index;
  // Until one read lands, a failure retries with backoff, or every chip shows a raw key.
  const {
    data: tags,
    dataRef: tagsRef,
    reload,
    update,
  } = useRegistryRead(
    'useTags',
    (client) => client.listTags(),
    FIRST_READ_TRIES,
  );

  // A write shows at once; the re-read after it confirms it.
  const apply = useCallback(
    (next: Tag) => {
      update((prev) =>
        prev.some((t) => t.key === next.key)
          ? prev.map((t) => (t.key === next.key ? next : t))
          : [...prev, next],
      );
      reload();
    },
    [update, reload],
  );

  // Until the list is read, a new key could reuse a deleted one, so nothing is written.
  const write = useCallback(
    async (
      op: (client: RegistryClient, tags: Tag[]) => Promise<void>,
      failed: string,
    ) => {
      try {
        const current = tagsRef.current;
        if (!registryClient || !current) throw new Error('tags not read yet');
        await op(registryClient, current);
      } catch (e: unknown) {
        console.warn('[useTags] write failed', e);
        toast.error(failed);
        throw e;
      }
    },
    [registryClient, tagsRef],
  );

  const setTag = useCallback(
    async (next: Tag | undefined) => {
      await write((client) => {
        if (!next) throw new Error('unknown tag');
        return client.setTag({
          key: next.key,
          name: next.name,
          color: next.color,
        });
      }, SAVE_FAILED);
      if (next) apply(next);
    },
    [write, apply],
  );

  // Writing a deleted tag's record would bring it back everywhere.
  const changeTag = useCallback(
    async (key: string, change: (tag: Tag) => Tag) => {
      const tag = tagsRef.current?.find((t) => t.key === key);
      if (tag?.deleted) {
        toast.error(TAG_DELETED);
        throw new Error(`tag ${key} is deleted`);
      }
      await setTag(tag && change(tag));
    },
    [setTag, tagsRef],
  );

  const createTag = useCallback(
    async (raw: string, color: string) => {
      const name = normalizeTagName(raw);
      if (!name) throw new Error('empty tag name');
      const existing = findTagByName(tagsRef.current ?? [], name);
      if (existing) return existing.key;
      const key = tagKeyFor(
        name,
        new Set((tagsRef.current ?? []).map((t) => t.key)),
      );
      await setTag({ key, name, color, deleted: false });
      return key;
    },
    [setTag, tagsRef],
  );

  const renameTag = useCallback(
    async (key: string, raw: string) => {
      const name = normalizeTagName(raw);
      if (!name) throw new Error('empty tag name');
      const taken = findTagByName(tagsRef.current ?? [], name);
      if (taken && taken.key !== key) throw new TagNameTakenError();
      await changeTag(key, (tag) => ({ ...tag, name }));
    },
    [changeTag, tagsRef],
  );

  const recolorTag = useCallback(
    (key: string, color: string) =>
      changeTag(key, (tag) => ({ ...tag, color })),
    [changeTag],
  );

  const deleteTag = useCallback(
    async (key: string, editable: ReadonlySet<string>) => {
      await write(async (registry) => {
        const { rows, contextOf, clientOf } = indexRef.current;
        const contexts = new Set<string>();
        const untag = rows.flatMap((r) => {
          const contextId = contextOf(r.folderId);
          const client = clientOf(r.folderId);
          if (!contextId || !client || !editable.has(r.folderId)) return [];
          if (!r.tags.includes(key)) return [];
          contexts.add(contextId);
          return [{ client, id: r.docId }];
        });
        const results = await settleInPool(untag, UNTAG_IN_FLIGHT, (doc) =>
          doc.client.removeTag({ id: doc.id, tag: key }),
        );
        // A doc left with the key shows nothing once the tag is deleted.
        for (const result of results) {
          if (result.status === 'rejected')
            console.warn('[useTags] untagging a doc failed', result.reason);
        }
        contexts.forEach(notifyDocsRefetch);
        await registry.deleteTag({ key });
      }, DELETE_FAILED);
      const tag = tagsRef.current?.find((t) => t.key === key);
      if (tag) apply({ ...tag, deleted: true });
    },
    [write, apply, tagsRef],
  );

  return useMemo(() => {
    const list = tags ?? [];
    return {
      tags: list,
      byKey: new Map(list.map((t) => [t.key, t])),
      createTag,
      renameTag,
      recolorTag,
      deleteTag,
    };
  }, [tags, createTag, renameTag, recolorTag, deleteTag]);
}
