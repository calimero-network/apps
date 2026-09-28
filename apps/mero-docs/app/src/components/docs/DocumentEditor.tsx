// Data-layer bridge between EditorShell and the document CRDT. There is no
// autosave, no snapshot and no save sequence: the title and the body are each
// bound to their own CRDT hook, which turns an edit into a delta and a peer's
// event into a re-read. EditorShell owns every piece of visual chrome.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import {
  useSubscription,
  type SubscriptionEventData,
} from '@calimero-network/mero-react';
import { toast } from 'sonner';
import { EditorShell } from '@/components/editor/EditorShell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { DocDto } from '@/generated/docs/DocsClient';
import { DocTags } from '@/components/tags/DocTags';
import { isContextEvent } from '@/hooks/useContextEvents';
import { useDocs } from '@/hooks/useDocs';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { LG_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useFugueBody, type BodyEditor } from '@/hooks/useFugueBody';
import { useFugueTitle } from '@/hooks/useFugueTitle';
import { useBodyCursors, type CursorEditor } from '@/hooks/useBodyCursors';
import { useDocPresence } from '@/hooks/useDocPresence';
import { useTitleCursors } from '@/hooks/useTitleCursors';
import { useCanManageTags } from '@/hooks/useTags';
import type { DriveEditor } from '@/components/editor/blocknote/schema';
import { ArchivedBanner } from '@/components/editor/ArchivedBanner';
import { DocDetails } from './DocDetails';
import { DocumentInspector } from './DocumentInspector';
import { UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';
import { copyLink } from '@/lib/copyLink';
import { parseMetaChanges } from '@/lib/rich/events';
import { docUrl, parseAppPath } from '@/lib/routes';

const TITLE_REFETCH_MS = 800; // one list refetch per rename, not per keystroke
const TAG_ADD_FAILED = "Couldn't add the tag. Try again.";
const TAG_REMOVE_FAILED = "Couldn't remove the tag. Try again.";
const ARCHIVE_FAILED = "Couldn't archive the document. Try again.";
const UNARCHIVE_FAILED = "Couldn't unarchive the document. Try again.";
const DETAILS_OPEN_KEY = 'mero-drive:details-open'; // this device's Details panel, from lg up

interface Props {
  folderId: string;
  docId: string;
  onClose: () => void;
  onDeleted: () => void;
  folderName?: string;
}

export function DocumentEditor({
  folderId,
  docId,
  onClose,
  onDeleted,
  folderName,
}: Props) {
  const { namespaceId, selfIdentity, namespaceMemberNames } =
    useDriveWorkspace();
  const isOnline = useOnlineStatus();
  const location = useLocation();
  const linkedBlock = parseAppPath(location.pathname, location.hash)?.block;
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  // Doc-edit ability is the registry Role, gated through useFolderPermissions.
  // A caps-fetch failure leaves this false, so the editor opens read-only
  // rather than writable on error.
  const canEditDocs = perms.canEditDocs;
  const canManageTags = useCanManageTags();
  // Tags and archive are for editors of this folder, never guests.
  const canOrganize = canEditDocs && canManageTags;
  const docs = useDocs(folderId);
  const {
    addTag: docsAddTag,
    removeTag: docsRemoveTag,
    archive: docsArchive,
    unarchive: docsUnarchive,
    remove: docsRemove,
    get: docsGet,
    contextId: docsContextId,
    refetch: docsRefetch,
    client,
  } = docs;
  const confirm = useConfirm();
  // Settled with an error and no context (e.g. access lost): no longer "connecting".
  const contextFailed =
    !docsContextId && !docs.contextResolving && docs.error !== null;

  // Metadata only; the title and the body are read through their own hooks.
  const [doc, setDoc] = useState<DocDto | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const identity = useMemo(
    () =>
      selfIdentity
        ? {
            id: selfIdentity,
            name: namespaceMemberNames[selfIdentity] || UNNAMED_MEMBER_LABEL,
          }
        : null,
    [selfIdentity, namespaceMemberNames],
  );
  const openDocId = docsContextId ? docId : null;

  const { peers, publish } = useDocPresence(docsContextId, openDocId, identity);
  const title = useFugueTitle({
    client,
    docId: openDocId,
    contextId: docsContextId,
    publish,
  });
  const [editor, setEditor] = useState<DriveEditor | null>(null);
  const body = useFugueBody({
    client,
    docId: openDocId,
    contextId: docsContextId,
    editor: editor as unknown as BodyEditor | null,
  });
  const { backendIdOf, editorIdOf, isConfirmed } = body;
  const sectionLinks = useMemo(
    () =>
      namespaceId
        ? {
            copy: (blockId: string, section: string) =>
              void copyLink(
                docUrl(namespaceId, folderId, docId, backendIdOf(blockId)),
                `Link to "${section}" copied`,
              ),
            isConfirmed,
          }
        : undefined,
    [namespaceId, folderId, docId, backendIdOf, isConfirmed],
  );
  const onEditorReady = useCallback(
    (ready: DriveEditor) => setEditor(ready),
    [],
  );
  const peerList = useMemo(
    () =>
      [...peers].map(([id, p]) => ({ id, name: p.name, colour: p.colour })),
    [peers],
  );
  const titleCarets = useTitleCursors(client, openDocId, peers, title.title);
  useBodyCursors({
    client,
    docId: openDocId,
    editor: editor as CursorEditor | null,
    peers,
    publish,
    revision: body.revision,
    toBackendId: body.backendIdOf,
    toEditorId: body.editorIdOf,
  });

  useEffect(() => {
    if (!docsContextId) return;
    let alive = true;
    setLoadError(null);
    setDoc(null);
    docsGet(docId)
      .then((loaded) => alive && setDoc(loaded))
      .catch((cause: unknown) => {
        if (!alive) return;
        setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      alive = false;
    };
  }, [docId, docsContextId, docsGet]);

  // Only the newest re-read lands; a failed one keeps the tags and archive state already shown.
  const rereadSeqRef = useRef(0);
  const rereadDoc = useCallback(() => {
    const seq = ++rereadSeqRef.current;
    docsGet(docId).then(
      (loaded) => seq === rereadSeqRef.current && setDoc(loaded),
      (cause: unknown) =>
        console.warn('[DocumentEditor] doc re-read failed', cause),
    );
  }, [docId, docsGet]);
  const metaEventContexts = useMemo(
    () => (docsContextId ? [docsContextId] : []),
    [docsContextId],
  );
  // Doc ids repeat across folders, so the event must come from this doc's context.
  const onMetaEvent = useCallback(
    (event: SubscriptionEventData) => {
      if (!isContextEvent(event) || event.contextId !== docsContextId) return;
      if (parseMetaChanges(event.data).includes(docId)) rereadDoc();
    },
    [docsContextId, docId, rereadDoc],
  );
  useSubscription(metaEventContexts, onMetaEvent);
  const onAddTag = useCallback(
    (key: string) =>
      void docsAddTag(docId, key).then(rereadDoc, (cause: unknown) => {
        console.warn('[DocumentEditor] add tag failed', cause);
        toast.error(TAG_ADD_FAILED);
      }),
    [docsAddTag, docId, rereadDoc],
  );
  const onRemoveTag = useCallback(
    (key: string) =>
      void docsRemoveTag(docId, key).then(rereadDoc, (cause: unknown) => {
        console.warn('[DocumentEditor] remove tag failed', cause);
        toast.error(TAG_REMOVE_FAILED);
      }),
    [docsRemoveTag, docId, rereadDoc],
  );

  const setArchived = useCallback(
    (archived: boolean) =>
      void (archived ? docsArchive : docsUnarchive)(docId).then(
        rereadDoc,
        (cause: unknown) => {
          console.warn('[DocumentEditor] archive change failed', cause);
          toast.error(archived ? ARCHIVE_FAILED : UNARCHIVE_FAILED);
        },
      ),
    [docsArchive, docsUnarchive, docId, rereadDoc],
  );

  // The panel beside the document is remembered; the sheet below lg opens only when asked.
  const isDesktop = useMediaQuery(LG_QUERY);
  const [panelOpen, setPanelOpen] = useLocalStorage(DETAILS_OPEN_KEY, false);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (isDesktop) setSheetOpen(false);
  }, [isDesktop]);
  const detailsOpen = isDesktop ? panelOpen : sheetOpen;
  const setDetailsOpen = isDesktop ? setPanelOpen : setSheetOpen;

  // The sidebar renders the title, so let the list catch up once typing stops.
  useEffect(() => {
    if (!title.title) return;
    const timer = setTimeout(() => void docsRefetch(), TITLE_REFETCH_MS);
    return () => clearTimeout(timer);
  }, [title.title, docsRefetch]);

  const onDelete = useCallback(async () => {
    if (!doc) return;
    const ok = await confirm({
      title: 'Delete document?',
      body: (
        <>
          Delete <span className="font-medium">{title.title || 'Untitled'}</span>?
          This can't be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await docsRemove(doc.id);
      onDeleted();
    } catch (cause) {
      console.error('delete failed', cause);
      toast.error("Couldn't delete document");
    }
  }, [confirm, doc, docsRemove, onDeleted, title.title]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-destructive">
            Couldn't load document
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loadError.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <EditorShell
        documentName={title.title || 'Untitled'}
        // Every mutation handler gates on canEditDocs so a read-only viewer
        // cannot rename, edit or delete; EditorShell's readOnly flag is the
        // second layer, not the authoritative one.
        title={
          canEditDocs && title.loaded
            ? {
                value: title.title,
                onChange: title.onChange,
                onSelect: title.onSelect,
                onKeyDown: title.onKeyDown,
                inputRef: title.inputRef,
                carets: titleCarets,
              }
            : undefined
        }
        onBack={onClose}
        folderName={folderName}
        onDelete={canEditDocs ? onDelete : undefined}
        onCopyLink={
          namespaceId
            ? () => void copyLink(docUrl(namespaceId, folderId, docId))
            : undefined
        }
        onUndo={canEditDocs ? body.undo : undefined}
        onRedo={canEditDocs ? body.redo : undefined}
        onContentChange={canEditDocs ? body.onContentChange : undefined}
        readOnly={!canEditDocs}
        initialContent={body.content}
        saveStatus={body.status}
        lastSavedAt={doc ? new Date(doc.updated_at / 1_000_000) : null}
        isAppReady={!!namespaceId && !!docsContextId}
        isOffline={!isOnline || contextFailed}
        isLoading={body.loading}
        onEditorReady={onEditorReady}
        peers={peerList}
        sectionLinks={sectionLinks}
        focusBlock={linkedBlock && editorIdOf(linkedBlock)}
        focusKey={location.key}
        tags={
          doc && (
            <DocTags
              tagKeys={doc.tags}
              canEdit={canOrganize}
              onAdd={onAddTag}
              onRemove={onRemoveTag}
            />
          )
        }
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen(!detailsOpen)}
        onArchive={
          canOrganize && doc && !doc.archived
            ? () => setArchived(true)
            : undefined
        }
        onUnarchive={
          canOrganize && doc?.archived ? () => setArchived(false) : undefined
        }
        notice={
          doc?.archived && (
            <ArchivedBanner
              onUnarchive={canOrganize ? () => setArchived(false) : undefined}
            />
          )
        }
      />
      {detailsOpen && (
        <DocDetails
          folderId={folderId}
          docId={docId}
          folderName={folderName}
          sheet={!isDesktop}
          onClose={() => setDetailsOpen(false)}
        />
      )}
      <DocumentInspector client={client} docId={docId} />
    </div>
  );
}
