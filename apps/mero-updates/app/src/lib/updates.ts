import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMero, useNodeIdentity } from "@calimero-network/mero-react";

import { getContextId } from "./session";
import { UpdatesClient } from "../generated/UpdatesClient";

/**
 * The audience this node is in. One context == one audience.
 *
 * An explicit choice made on the companies/audiences pages and recorded in
 * `lib/session` — never "the first context on the node", which on a node
 * running several Calimero apps is somebody else's contract.
 */
export function useAudienceContextId(): string | null {
  const [contextId, setContextId] = useState<string | null>(getContextId);
  useEffect(() => setContextId(getContextId()), []);
  return contextId;
}

/**
 * This node's ACCOUNT id — what the contract records as author, reader and
 * helper. Not the context identity: both are 64 hex characters, so mixing them
 * type-checks and then marks every one of your own posts as somebody else's.
 */
export function useSelfAccount(): string | null {
  const { identity } = useNodeIdentity();
  return identity?.accountId ?? null;
}

export function useUpdatesClient(): UpdatesClient | null {
  const { mero } = useMero();
  const contextId = useAudienceContextId();
  const [executor, setExecutor] = useState<string | null>(null);

  useEffect(() => {
    if (!mero || !contextId) {
      setExecutor(null);
      return;
    }
    let cancelled = false;
    mero.admin
      .getContextIdentitiesOwned(contextId)
      .then(({ identities }) => {
        if (!cancelled && identities.length > 0) setExecutor(identities[0]);
      })
      .catch(() => !cancelled && setExecutor(null));
    return () => {
      cancelled = true;
    };
  }, [mero, contextId]);

  return useMemo(
    () =>
      mero && contextId && executor ? new UpdatesClient(mero, contextId) : null,
    [mero, contextId, executor],
  );
}

// ── Live refresh ─────────────────────────────────────────────────────────────
//
// One counter per audience, bumped by every contract event (a peer's update
// replicating in, a reaction, a read receipt) and by every stream reconnect.
// Each data hook re-reads when it moves. Coarse on purpose: an investor-update
// audience changes a few times a day, and "re-read what is on screen" is
// simpler and harder to get wrong than patching lists from event payloads.

export const RevisionContext = createContext<{
  revision: number;
  bump: () => void;
}>({ revision: 0, bump: () => undefined });

export function useRevision() {
  return useContext(RevisionContext);
}

/**
 * Load `fn` with the client, and again whenever the audience changes.
 *
 * `data` is kept across re-reads (no flash back to a spinner every time a
 * peer reacts); `loading` is only true until the first answer.
 */
export function useLive<T>(
  fn: (client: UpdatesClient) => Promise<T>,
  deps: unknown[],
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (next: T | null) => void;
} {
  const client = useUpdatesClient();
  const { revision } = useRevision();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [local, setLocal] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    fnRef
      .current(client)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, revision, local, ...deps]);

  const reload = useCallback(() => setLocal((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "3h ago" — short, and stable enough not to need a ticking clock. */
export function timeAgo(ms: number, now: number = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * "Due in 3 days" / "Due today" / "5 days overdue". Days, not hours: a cadence
 * is monthly or quarterly, and "due in 71h" is precision nobody asked for.
 */
export function dueLabel(dueMs: number, now: number = Date.now()): string {
  const day = 86_400_000;
  const days = Math.round((dueMs - now) / day);
  if (days === 0) return "Due today";
  if (days > 0) return `Due in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** First 6 + last 4 of an account id: enough to tell two people apart. */
export function shortAccount(account: string): string {
  return account.length > 12
    ? `${account.slice(0, 6)}…${account.slice(-4)}`
    : account;
}

/** A person's label: their chosen name, else a short id. */
export function personLabel(name: string, account: string): string {
  return name.trim() || shortAccount(account);
}

// ── Metrics ──────────────────────────────────────────────────────────────────

/**
 * The number inside a reported KPI string.
 *
 * Founders write "$1.2M", "38%", "12.5k", "1,204", "-3.5". The contract keeps
 * the string exactly as written; this recovers the magnitude so the UI can
 * chart a series and show a delta. Returns null when there is no number, so
 * "n/a" or "TBD" renders as text instead of as zero.
 */
export function parseMetric(value: string): number | null {
  const m = value
    .replace(/,/g, "")
    // The suffix must END the token: "18 months" is eighteen, not 18M.
    .match(/(-?\d+(?:\.\d+)?)\s*(?:([kKmMbB])(?![a-zA-Z]))?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult =
    { k: 1e3, m: 1e6, b: 1e9 }[
      (m[2] ?? "").toLowerCase() as "k" | "m" | "b"
    ] ?? 1;
  return n * mult;
}

/** Relative change from `prev` to `next`, as "+12%" / "−4%", or null. */
export function deltaLabel(prev: string, next: string): string | null {
  const a = parseMetric(prev);
  const b = parseMetric(next);
  if (a === null || b === null || a === 0) return null;
  const pct = ((b - a) / Math.abs(a)) * 100;
  if (!Number.isFinite(pct)) return null;
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  if (rounded === 0) return "±0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const ASK_KINDS: { id: string; label: string; icon: string; hint: string }[] = [
  { id: "intro", label: "Intro", icon: "🤝", hint: "An introduction to a person or company" },
  { id: "hire", label: "Hiring", icon: "🧑‍💻", hint: "A candidate referral" },
  { id: "customer", label: "Customer", icon: "🛒", hint: "A lead or a design partner" },
  { id: "advice", label: "Advice", icon: "💡", hint: "Expertise or a second opinion" },
  { id: "fundraising", label: "Fundraising", icon: "💰", hint: "An investor intro or a term-sheet read" },
  { id: "other", label: "Other", icon: "✨", hint: "Anything else" },
];

export function askKind(id: string) {
  return ASK_KINDS.find((k) => k.id === id) ?? ASK_KINDS[ASK_KINDS.length - 1];
}

/** Must match `REACTIONS` in logic/src/lib.rs — the contract rejects others. */
export const REACTIONS = ["👍", "🎉", "❤️", "🚀", "👀", "🙏"] as const;

export const CATEGORY_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#525252",
];
