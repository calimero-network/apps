import { useEffect, useState } from "react";

import { clearActiveAudience, getContextId } from "./active";
import { useMaybeSignedIn } from "./sessionContext";

/**
 * Whether the remembered audience can be opened.
 *
 * It is remembered across reloads and sign-ins, so it can name an instance
 * that was deleted, or one this account can no longer reach (removed from the
 * company, or another account signed in on this browser). Before the shell
 * opens it, the account's instances of this app are asked; one it cannot see
 * is dropped, and the person lands on the company picker instead of a shell
 * whose every read fails.
 */
export type StoredAudience = "none" | "checking" | "open";

export interface StoredAudienceInput {
  stored: string | null;
  /** The instance ids the account can see; null until the node has answered. */
  listed: readonly string[] | null;
}

export function decideStoredAudience(i: StoredAudienceInput): { state: StoredAudience; drop: boolean } {
  if (!i.stored) return { state: "none", drop: false };
  if (!i.listed) return { state: "checking", drop: false };
  return i.listed.includes(i.stored) ? { state: "open", drop: false } : { state: "none", drop: true };
}

/** The remembered audience's standing for this account; drops it when it has none. */
export function useStoredAudience(): StoredAudience {
  const signedIn = useMaybeSignedIn();
  const stored = getContextId();
  const key = `${signedIn?.accountId ?? ""}\n${stored ?? ""}`;
  const [answer, setAnswer] = useState<{ key: string; listed: string[] } | null>(null);
  const decision = decideStoredAudience({ stored, listed: answer?.key === key ? answer.listed : null });

  const client = signedIn?.client ?? null;
  const source = signedIn?.source ?? null;
  const ask = decision.state === "checking" && !!client;
  useEffect(() => {
    if (!ask || !client || !source || !stored) return;
    let cancelled = false;
    const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
    client
      .listApps(filter)
      .then((apps) => apps.map((a) => a.appId))
      // Unreachable: keep it and let the shell report the error, rather than
      // forgetting a choice over a network blip.
      .catch(() => [stored])
      .then((listed) => {
        if (!cancelled) setAnswer({ key, listed });
      });
    return () => {
      cancelled = true;
    };
  }, [ask, client, source, stored, key]);

  useEffect(() => {
    if (decision.drop) clearActiveAudience();
  }, [decision.drop]);

  return decision.state;
}
