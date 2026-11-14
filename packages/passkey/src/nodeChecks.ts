import { useCallback, useEffect, useState } from "react";
import type { CalimeroClient, NodeVerificationState, PackageCapabilities } from "@calimero-network/mero-js";
import { checkAppCode, type AppCodeCheck } from "@calimero-apps/connect";

import type { ShieldApp } from "./nodeShieldStore";

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;
const NODE_POLL_MS = 1_000; // how often to notice that the client failed over

/** An unreachable node is asked again after 2 s, 4 s, 8 s, up to 30 s. */
const retryDelay = (attempt: number) => Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);

/** The check's outcome, or `null` for a client that cannot be checked: it stays "checking" instead of taking the app down or retrying. */
async function check(client: CalimeroClient): Promise<NodeVerificationState | null> {
  try {
    return await client.verify();
  } catch {
    return null;
  }
}

function peek(client: CalimeroClient | null): NodeVerificationState {
  let known: NodeVerificationState | undefined;
  try {
    known = client?.verification();
  } catch {
    // A client that cannot say is still being checked.
  }
  return known ?? { status: "checking", url: client?.nodeUrl ?? "" };
}

/** The check of the node in use, asked again after a failure to reach it, a failover, and whenever `refresh` is called. */
export function useNodeVerification(client: CalimeroClient | null): [NodeVerificationState, () => void] {
  const [state, setState] = useState(() => peek(client));
  const [round, setRound] = useState(0);
  const [url, setUrl] = useState(client?.nodeUrl);
  useEffect(() => {
    setUrl(client?.nodeUrl);
    if (!client) return;
    const poll = setInterval(() => setUrl(client.nodeUrl), NODE_POLL_MS);
    return () => clearInterval(poll);
  }, [client]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (attempt: number) => {
      const next = await check(client);
      if (!live || !next) return;
      setState(next);
      if (next.status === "unreachable") timer = setTimeout(() => void run(attempt + 1), retryDelay(attempt));
    };
    setState(peek(client));
    void run(0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, round, url]);
  // Never describe a node the client has moved on from: compared with the node in use now, not the last poll.
  const inUse = client?.nodeUrl;
  const shown: NodeVerificationState = inUse && state.url !== inUse ? { status: "checking", url: inUse } : state;
  return [shown, useCallback(() => setRound((n) => n + 1), [])];
}

/** The app's code check of verified node `url`, run when the popover opens and shown only while that node is still the one in use. */
export function useAppCode(client: CalimeroClient | null, app: ShieldApp | null, url: string | null): AppCodeCheck | null {
  const [result, setResult] = useState<{ client: CalimeroClient; app: ShieldApp; url: string; code: AppCodeCheck } | null>(null);
  useEffect(() => {
    if (!client || !app || !url) return;
    let live = true;
    void checkAppCode(client, app.id, app.source).then((code) => {
      if (live && client.nodeUrl === url) setResult({ client, app, url, code });
    });
    return () => {
      live = false;
    };
  }, [client, app, url]);
  const current = result?.client === client && result?.app === app && result?.url === url && client?.nodeUrl === url;
  return current ? result.code : null;
}

/** The package release a review is about. */
export interface ReviewRelease {
  package: string;
  version: string;
}

export type CardState =
  | { status: "loading" }
  | { status: "ready"; card: PackageCapabilities }
  | { status: "error"; message: string }
  /** The node did not pass its own check, so it is not asked and not retried. */
  | { status: "refused" };

/** A plain sentence for a failed card request: never the node's raw error text. */
export function cardError(e: unknown): string {
  const status = typeof e === "object" && e !== null && "status" in e ? (e as { status: unknown }).status : undefined;
  if (status === 404) return "This node cannot show app reviews yet.";
  if (status === 401 || status === 403) return "You don't have access to this app's details.";
  return "The review of this app could not load.";
}

/** The release's capability card from the node the session talks to, asked only once the node's own check verified it, and again on `retry`. */
export function useCard(client: CalimeroClient | null, release: ReviewRelease, node: NodeVerificationState): [CardState, () => void] {
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [round, setRound] = useState(0);
  const gate = node.status === "verified" ? "verified" : node.status === "refused" ? "refused" : "waiting";
  useEffect(() => {
    if (!client) {
      setState({ status: "error", message: "Not connected to a node." });
      return;
    }
    if (gate !== "verified") {
      setState(gate === "refused" ? { status: "refused" } : { status: "loading" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    client.packageCapabilities(release.package, release.version).then(
      (card) => live && setState({ status: "ready", card }),
      (e: unknown) => live && setState({ status: "error", message: cardError(e) }),
    );
    return () => {
      live = false;
    };
  }, [client, release.package, release.version, round, gate]);
  return [state, useCallback(() => setRound((n) => n + 1), [])];
}
