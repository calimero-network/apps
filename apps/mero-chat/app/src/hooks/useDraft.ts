import { useCallback, useEffect, useRef, useState } from "react";
import { getContextId, getContextIdentity } from "../api/calimero";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { emptyText } from "../utils/markdownParser";

const DEBOUNCE_MS = 4_000;

/**
 * Manages a per-channel message draft backed by WASM storage.
 *
 * - Loads the persisted draft whenever `channelName` changes.
 * - Debounces saves: calling `setDraft` queues a WASM write 4s after the
 *   last keystroke.
 * - Deletes the WASM draft when `clearDraft` is called (on send or empty),
 *   but only for a channel whose draft is actually stored: emptying the field
 *   or sending used to send deleteDraft every time, saved or not.
 */
export function useDraft(channelName: string | undefined): {
  draft: string;
  hasDraft: boolean;
  setDraft: (text: string) => void;
  clearDraft: () => void;
} {
  const [draft, setDraftState] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef(channelName);
  channelRef.current = channelName;
  const pendingTextRef = useRef<string>("");
  // Channels whose draft is stored on the node (loaded non-empty, or saved).
  const storedRef = useRef<Set<string>>(new Set());

  const deleteStored = useCallback((channel: string) => {
    if (!storedRef.current.has(channel)) return;
    const contextId = getContextId();
    const executorPublicKey = getContextIdentity();
    if (!contextId || !executorPublicKey) return;
    storedRef.current.delete(channel);
    void new ClientApiDataSource().deleteDraft(contextId, executorPublicKey, channel);
  }, []);

  // Load draft when channel changes.
  useEffect(() => {
    // Immediately clear stale draft so hasDraft never reflects the previous channel.
    setDraftState("");

    if (!channelName) return;
    const contextId = getContextId();
    const executorPublicKey = getContextIdentity();
    if (!contextId || !executorPublicKey) return;

    let cancelled = false;
    const stored = storedRef.current;
    (async () => {
      const res = await new ClientApiDataSource().getDraft(contextId, executorPublicKey, channelName);
      if (cancelled) return;
      if (res.data) stored.add(channelName);
      setDraftState(res.data ?? "");
    })();

    return () => {
      cancelled = true;
      // Flush any pending save for the channel we're leaving before clearing the timer.
      // Use `channelName` from the closure — channelRef.current is already the new value.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        const ctx = getContextId();
        const key = getContextIdentity();
        if (ctx && key && channelName && pendingTextRef.current) {
          stored.add(channelName);
          void new ClientApiDataSource().saveDraft(ctx, key, channelName, pendingTextRef.current);
        }
      }
    };
  }, [channelName]);

  const persistDraft = useCallback((channel: string, text: string) => {
    const contextId = getContextId();
    const executorPublicKey = getContextIdentity();
    if (!contextId || !executorPublicKey) return;
    storedRef.current.add(channel);
    void new ClientApiDataSource().saveDraft(contextId, executorPublicKey, channel, text);
  }, []);

  const setDraft = useCallback(
    (text: string) => {
      const isEmpty = !text || emptyText.test(text);
      setDraftState(isEmpty ? "" : text);
      pendingTextRef.current = isEmpty ? "" : text;

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!channelRef.current) return;
      const channel = channelRef.current;

      if (isEmpty) {
        // Clear immediately when the field is emptied, if a draft is stored.
        deleteStored(channel);
        return;
      }

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        persistDraft(channel, text);
      }, DEBOUNCE_MS);
    },
    [persistDraft, deleteStored],
  );

  const clearDraft = useCallback(() => {
    setDraftState("");
    pendingTextRef.current = "";
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const channel = channelRef.current;
    if (channel) deleteStored(channel);
  }, [deleteStored]);

  return { draft, hasDraft: draft.length > 0 && !emptyText.test(draft), setDraft, clearDraft };
}
