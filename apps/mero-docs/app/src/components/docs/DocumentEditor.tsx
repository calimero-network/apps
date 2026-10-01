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
import { useAddImages } from '@/hooks/useAddImages';
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
import {
  documentLoadErrorMessage,
  documentSaveErrorMessage,
} from '@/lib/documentError';

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
  const isOffline = !isOnline || contextFailed;
  // Tags, archive and delete are direct calls that fail offline. Typing is not
  // gated: the body and title hooks queue their writes and retry.
  const canOrganize = canEditDocs && canManageTags && !isOffline;

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
  const addImages = useAddImages(editor, docsContextId);
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
    () => [...peers].map(([id, p]) => ({ id, name: p.name, colour: p.colour })),
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
        console.error('document load failed', cause);
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
  const mutate = useCallback(
    (pending: Promise<unknown>, failed: string) =>
      void pending.then(rereadDoc, (cause: unknown) => {
        console.warn('[DocumentEditor]', failed, cause);
        toast.error(failed);
      }),
    [rereadDoc],
  );
  const onAddTag = useCallback(
    (key: string) => mutate(docsAddTag(docId, key), TAG_ADD_FAILED),
    [mutate, docsAddTag, docId],
  );
  const onRemoveTag = useCallback(
    (key: string) => mutate(docsRemoveTag(docId, key), TAG_REMOVE_FAILED),
    [mutate, docsRemoveTag, docId],
  );
  const setArchived = useCallback(
    (archived: boolean) =>
      archived
        ? mutate(docsArchive(docId), ARCHIVE_FAILED)
        : mutate(docsUnarchive(docId), UNARCHIVE_FAILED),
    [mutate, docsArchive, docsUnarchive, docId],
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
  // The status bar only says "Save failed"; this says why. Only a failed save
  // sets 'error' (a failed re-read sets `error` alone), and one toast id means a
  // save that keeps failing replaces its message instead of stacking copies.
  useEffect(() => {
    if (body.status !== 'error' || !body.error) return;
    console.error('document save failed', body.error);
    toast.error(documentSaveErrorMessage(body.error), {
      id: `doc-save-${docId}`,
    });
  }, [body.status, body.error, docId]);

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
          Delete{' '}
          <span className="font-medium">{title.title || 'Untitled'}</span>? This
          can't be undone.
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
            {documentLoadErrorMessage(loadError)}
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
        onDelete={
          canEditDocs && !isOffline && doc?.can_delete ? onDelete : undefined
        }
        onCopyLink={
          namespaceId
            ? () => void copyLink(docUrl(namespaceId, folderId, docId))
            : undefined
        }
        onUndo={canEditDocs ? body.undo : undefined}
        onRedo={canEditDocs ? body.redo : undefined}
        onContentChange={canEditDocs ? body.onContentChange : undefined}
        readOnly={!canEditDocs}
        imageContextId={docsContextId}
        onAddImages={canEditDocs ? addImages : undefined}
        initialContent={body.content}
        saveStatus={body.status}
        lastSavedAt={doc ? new Date(doc.updated_at / 1_000_000) : null}
        isAppReady={!!namespaceId && !!docsContextId}
        isOffline={isOffline}
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
