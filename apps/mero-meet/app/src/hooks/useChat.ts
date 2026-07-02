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
  // Feature detection: rooms may run a contract version without the chat
  // methods (post_message/get_messages), where every call returns null. Stop
  // the poll loop instead of burning an errored RPC every 4s, hide the chat UI
  // (CallView checks `supported`), and re-probe on SSE/panel-open so a room
  // upgraded mid-call heals on its own.
  const [supported, setSupported] = useState(true);
  const lastSeqRef = useRef(0);
  const mutedRef = useRef(false); // when true, incoming messages count as unread

  const drain = useCallback(async () => {
    // Same seq-margin as signal draining: two nodes can mint the same msg seq
    // concurrently (next_msg_seq is an LwwRegister); re-reading a short window
    // and deduping by id (below) never misses the late-gossiped twin.
    const batch = await meet.getMessages(Math.max(0, lastSeqRef.current - 16));
    if (batch === null || batch === undefined) {
      setSupported(false);
      return;
    }
    setSupported(true);
    if (batch.length === 0) return;
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
    if (!supported) return; // probe once; SSE/panel-open re-probes
    const id = setInterval(() => void drain(), POLL_MS);
    return () => clearInterval(id);
  }, [enabled, supported, drain]);

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
    if (open) {
      setUnread(0);
      void drain(); // re-probe: heals `supported` after a room upgrade
    }
  }, [drain]);

  return { messages, unread, selfId, supported, send, setPanelOpen };
}
