import { useCallback, useEffect, useRef, useState } from "react";
import { useSubscription } from "@calimero-network/mero-react";
import { useMeroMeet } from "./useMeroMeet";
import { getExecutorPublicKey } from "../lib/session";
import type { ChatMessage } from "../types";

const POLL_MS = 4000;

/**
 * Per-room chat backed by the Calimero contract (post_message / get_messages).
 * Messages replicate to every node via CRDT gossip — there is no chat server.
 * Nudged by the `MessagePosted` SSE event, with a slow poll as a fallback.
 */
export function useChat(enabled: boolean) {
  const meet = useMeroMeet();
  const selfId = getExecutorPublicKey() ?? "";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const lastSeqRef = useRef(0);
  const mutedRef = useRef(false); // when true, incoming messages count as unread

  const drain = useCallback(async () => {
    const batch = await meet.getMessages(lastSeqRef.current);
    if (!batch || batch.length === 0) return;
    for (const m of batch) if (m.seq > lastSeqRef.current) lastSeqRef.current = m.seq;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = batch.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return prev;
      if (mutedRef.current) {
        const others = fresh.filter((m) => m.from !== selfId).length;
        if (others) setUnread((u) => u + others);
      }
      return [...prev, ...fresh].sort((a, b) => a.seq - b.seq);
    });
  }, [meet, selfId]);

  useEffect(() => {
    if (!enabled) return;
    void drain();
    const id = setInterval(() => void drain(), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, drain]);

  const onEvent = useCallback(
    (evt: { data: unknown }) => {
      const data = evt.data as Record<string, unknown> | null;
      const type = data && typeof data === "object" ? Object.keys(data)[0] : "";
      if (type === "MessagePosted") void drain();
    },
    [drain],
  );
  useSubscription(enabled && meet.contextId ? [meet.contextId] : [], onEvent);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      await meet.postMessage(trimmed);
      await drain();
    },
    [meet, drain],
  );

  /** Call when the chat panel is open (stops counting unread) or closed. */
  const setPanelOpen = useCallback((open: boolean) => {
    mutedRef.current = !open;
    if (open) setUnread(0);
  }, []);

  return { messages, unread, selfId, send, setPanelOpen };
}
