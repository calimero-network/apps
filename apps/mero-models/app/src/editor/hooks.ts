import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEphemeral, useMero, useSubscription } from "@calimero-network/mero-react";
import type { SubscriptionEventData } from "@calimero-network/mero-react";
import { MeroModelsClient } from "../generated/MeroModelsClient";
import { memberColor } from "./model";
import { useEditor } from "./store";
import { SceneSync, messageOf } from "./sync";
import type { Peer } from "./viewport";

/** How often to re-read the scene when no event arrived — a delta that landed while the stream reconnected. */
const POLL_MS = 8_000;

const NAME_KEY = "mero-models:name";

export function storedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private mode: the name is only forgotten */
  }
}

/** The generated client, bound to this session and context. */
export function useModelsClient(contextId: string): MeroModelsClient | null {
  const { mero } = useMero();
  return useMemo(() => (mero ? new MeroModelsClient(mero, contextId) : null), [mero, contextId]);
}

/**
 * Keep the editor store in step with the context: one `SceneSync` per open
 * scene, registered as the store's outbox, refreshed on every event for the
 * context (an event is a nudge to re-read, never the data) and on a slow poll.
 */
export function useSceneSync(contextId: string): { sync: SceneSync | null; saving: boolean } {
  const client = useModelsClient(contextId);
  const [sync, setSync] = useState<SceneSync | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!client) return;
    const s = new SceneSync(client, (message) => useEditor.getState().notify(message, true));
    useEditor.getState().setOutbox(s);
    setSync(s);
    void s.refresh();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void s.refresh();
    }, POLL_MS);
    const saver = window.setInterval(() => setSaving(s.saving), 300);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(saver);
      s.dispose();
      useEditor.getState().setOutbox(null);
      // A different scene must not inherit this one's objects or history.
      useEditor.setState({
        objects: new Map(),
        meshes: new Map(),
        selection: [],
        past: [],
        future: [],
        loaded: false,
        mode: "object",
        vertexSelection: new Set(),
      });
    };
  }, [client]);

  const nudge = useRef<number | null>(null);
  useSubscription(
    useMemo(() => [contextId], [contextId]),
    useCallback(
      (event: SubscriptionEventData) => {
        if ("contextId" in event && event.contextId !== contextId) return;
        // Several events arrive together for one transaction (and our own
        // writes echo back); one read covers them all.
        if (nudge.current !== null) window.clearTimeout(nudge.current);
        nudge.current = window.setTimeout(() => {
          nudge.current = null;
          void sync?.refresh();
        }, 120);
      },
      [contextId, sync],
    ),
  );

  return { sync, saving };
}

/** Tell the scene who this is. Re-sent when the name changes; refused silently by nobody. */
export function useJoin(contextId: string, name: string): void {
  const client = useModelsClient(contextId);
  useEffect(() => {
    if (!client) return;
    const t = window.setTimeout(() => {
      void client.join({ name: name || "Guest", now: Date.now() }).catch((e) => {
        // Presence in the members list is a nicety; editing works without it.
        console.warn("[mero-models] join failed:", messageOf(e));
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [client, name]);
}

/** What each open editor streams over ephemeral presence. Never stored. */
interface Slice {
  name: string;
  account: string;
  selection: string[];
  camera: [number, number, number] | null;
  target: [number, number, number] | null;
}

/**
 * Who else is in the scene right now, what they have selected and where they
 * are looking from — over the node's ephemeral channel, so a camera move is
 * not a transaction and nothing about it is kept.
 */
export function usePresence(contextId: string, name: string): {
  peers: Peer[];
  publishCamera: (camera: [number, number, number], target: [number, number, number]) => void;
} {
  const me = useEditor((s) => s.me);
  const selection = useEditor((s) => s.selection);
  const { peers, setPresence } = useEphemeral<Slice>(contextId, {
    throttleMs: 150,
    initial: { name, account: me, selection: [], camera: null, target: null },
  });

  useEffect(() => {
    setPresence({ name: name || "Guest", account: me, selection });
  }, [setPresence, name, me, selection]);

  const publishCamera = useCallback(
    (camera: [number, number, number], target: [number, number, number]) => setPresence({ camera, target }),
    [setPresence],
  );

  const list = useMemo(
    () =>
      [...peers].map(([key, slice]) => ({
        key,
        name: slice.name || "Guest",
        color: memberColor(slice.account || key),
        selection: Array.isArray(slice.selection) ? slice.selection.slice(0, 200) : [],
        camera: validTriple(slice.camera),
        target: validTriple(slice.target),
      })),
    [peers],
  );
  return { peers: list, publishCamera };
}

/** A peer's slice is whatever their client sent: take only a well-formed point. */
function validTriple(v: unknown): [number, number, number] | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (v as [number, number, number])
    : null;
}
