import { useEffect, useState } from "react";

import { useMaybeSignedIn } from "../sessionContext";
import { listInstances } from "./spaces";
import { clearActiveForum, getContextId } from "./session";

/**
 * Whether the remembered forum can be opened: `checking` until the cluster has
 * listed this account's forums, `open` when the remembered one is among them,
 * `none` otherwise (and the memory is dropped). It is remembered across
 * reloads, so it can name a forum since deleted, or one in a space this account
 * has left.
 */
export type StoredForum = "none" | "checking" | "open";

/** The decision, given the stored id and the instances listed (`null`: not answered yet). */
export function decideStoredForum(stored: string | null, listed: readonly string[] | null): StoredForum {
  if (!stored) return "none";
  if (!listed) return "checking";
  return listed.includes(stored) ? "open" : "none";
}

export function useStoredForum(): StoredForum {
  const signedIn = useMaybeSignedIn();
  const stored = signedIn ? getContextId() : null;
  const [answer, setAnswer] = useState<{ stored: string; listed: string[] } | null>(null);
  const state = decideStoredForum(stored, answer && answer.stored === stored ? answer.listed : null);

  const client = signedIn?.client;
  const source = signedIn?.source;
  const after = signedIn?.after;
  useEffect(() => {
    if (state !== "checking" || !client || !source || !stored) return;
    let live = true;
    listInstances(client, source)
      .then((apps) => apps.map((a) => a.appId))
      // Unreachable: keep the memory and let the feed say what is wrong.
      .catch(() => [stored])
      .then((listed) => {
        if (live) setAnswer({ stored, listed });
      })
      .finally(() => after?.());
    return () => {
      live = false;
    };
  }, [state, client, source, stored, after]);

  useEffect(() => {
    if (stored && state === "none") clearActiveForum();
  }, [stored, state]);

  return state;
}
