import { useEffect, useState } from "react";
import { useMero } from "@calimero-apps/cloud";

import {
  clearActiveAudience,
  getContextId,
  getAudienceNode,
  isAudienceConfirmed,
  markAudienceConfirmed,
} from "./session";

// Whether the audience this browser remembers may be opened on the node it is
// connected to NOW.
//
// The remembered audience is a context id, and it outlives both the node it was
// opened on and the context itself. Routed in unchecked, a node switch
// (localhost:2528 -> 2529) or a deleted / left audience lands in an updates feed whose
// every read fails. So the gates ask the node first, the way mero-stream's
// RequireStream does: open it only once the node lists it, drop it otherwise.

export type StoredAudience = "none" | "checking" | "open";

export interface StoredAudienceInput {
  stored: string | null;
  /** The node it was opened on; null for entries older builds wrote. */
  storedNode: string | null;
  node: string | null;
  /** Opened or listed on this node during this load. */
  confirmed: boolean;
  /** The context ids the node listed; null until it has answered. */
  listed: readonly string[] | null;
}

export function decideStoredAudience(i: StoredAudienceInput): {
  state: StoredAudience;
  drop: boolean;
} {
  if (!i.stored) return { state: "none", drop: false };
  // Chosen on another node: whatever this one holds under that id, it is not
  // the audience that was picked.
  if (i.storedNode && i.node && i.storedNode !== i.node)
    return { state: "none", drop: true };
  if (i.confirmed) return { state: "open", drop: false };
  if (!i.listed) return { state: "checking", drop: false };
  return i.listed.includes(i.stored)
    ? { state: "open", drop: false }
    : { state: "none", drop: true };
}

/** The remembered audience's standing on this node; drops it when it has none. */
export function useStoredAudience(): StoredAudience {
  const { admin, nodeUrl } = useMero();
  const node = nodeUrl ?? null;
  const stored = getContextId();
  const storedNode = getAudienceNode();
  // Keyed by what was asked, so an answer for another node or audience is unused.
  const [answer, setAnswer] = useState<{
    key: string;
    listed: string[];
  } | null>(null);
  const key = `${node ?? ""}\n${stored ?? ""}`;
  const confirmed = !!stored && isAudienceConfirmed(stored, node);
  const decision = decideStoredAudience({
    stored,
    storedNode,
    node,
    confirmed,
    listed: answer?.key === key ? answer.listed : null,
  });

  const ask = decision.state === "checking" && !!admin;
  useEffect(() => {
    if (!ask || !admin || !stored) return;
    let cancelled = false;
    admin
      .getContexts()
      .then((resp) => {
        const listed = (resp.contexts ?? []).map((c) => c.id);
        if (listed.includes(stored)) markAudienceConfirmed(stored, node);
        return listed;
      })
      // Couldn't reach the node to verify: let the page try rather than drop
      // a live audience on one flaky request (as mero-stream does), unconfirmed.
      .catch(() => [stored])
      .then((listed) => {
        if (!cancelled) setAnswer({ key, listed });
      });
    return () => {
      cancelled = true;
    };
  }, [ask, admin, stored, node, key]);

  useEffect(() => {
    if (decision.drop) clearActiveAudience();
  }, [decision.drop]);

  return decision.state;
}
