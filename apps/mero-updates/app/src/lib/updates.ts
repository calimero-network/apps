import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { describeError } from "@calimero-apps/connect";

import { getActiveNamespaceId, getContextId } from "./active";
import { readCompany } from "./companies";
import { useMaybeSignedIn } from "./sessionContext";
import { UpdatesClient } from "./updatesClient";

/**
 * The audience this browser has open: one app instance == one audience. An
 * explicit choice made on the companies/audiences pages (`lib/active`).
 */
export function useAudienceContextId(): string | null {
  const [contextId, setContextId] = useState<string | null>(getContextId);
  useEffect(() => setContextId(getContextId()), []);
  return contextId;
}

/** The signed-in ACCOUNT: what the contract records as author, reader and helper. */
export function useSelfAccount(): string | null {
  return useMaybeSignedIn()?.accountId ?? null;
}

/** The open audience through the signed-in client, or null while there is neither. */
export function useUpdatesClient(): UpdatesClient | null {
  const signedIn = useMaybeSignedIn();
  const contextId = useAudienceContextId();
  const client = signedIn?.client ?? null;
  const after = signedIn?.after;
  return useMemo(
    () => (client && contextId ? new UpdatesClient(client, contextId, after) : null),
    [client, contextId, after],
  );
}

// ── Live refresh ─────────────────────────────────────────────────────────────
//
// One counter per audience, bumped by every contract event (a peer's update
// replicating in, a reaction, a read receipt) and by every stream reconnect.
// Each data hook re-reads when it moves. Coarse on purpose: an investor-update
// audience changes a few times a day, and "re-read what is on screen" is
// simpler and harder to get wrong than patching lists from event payloads.

/** How long to wait before reopening a dropped event stream. */
const RECONNECT_MS = 2_000;

/**
 * Calls `onEvent` for every event of the audience `appId` (from now on), and
 * once more after every reconnect of the stream: events missed while it was
 * down are not replayed, so the screen re-reads instead. Replaces mero-react's
 * `useSubscription` + `useStreamReconnect`.
 */
export function useAudienceEvents(appId: string | null, onEvent: () => void): void {
  const signedIn = useMaybeSignedIn();
  const client = signedIn?.client ?? null;
  const after = signedIn?.after;
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!client || !appId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const open = async (reconnect: boolean) => {
      if (reconnect) handler.current();
      try {
        for await (const _event of client.events(appId, undefined, abort.signal)) {
          handler.current();
        }
      } catch {
        // Dropped (or refused): try again below, unless we are unmounting.
      } finally {
        after?.();
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void open(true), RECONNECT_MS);
    };
    void open(false);
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [client, appId, after]);
}

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
        if (!cancelled) setError(describeError(e));
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

/**
 * A person's label: their profile name here, else the name they set for the
 * whole company (`spaceName`), else a short id.
 */
export function personLabel(name: string, account: string, spaceName?: string): string {
  return name.trim() || (spaceName ?? "").trim() || shortAccount(account);
}

// The names members set for the whole company (org member metadata), read
// once per company and shared by every component that labels a person.
const companyNames = new Map<string, Map<string, string>>();
const listeners = new Set<() => void>();
const loading = new Set<string>();

function useCompanyNames(): (account: string | null | undefined) => string | undefined {
  const signedIn = useMaybeSignedIn();
  const org = getActiveNamespaceId();
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const client = signedIn?.client ?? null;
  useEffect(() => {
    if (!client || !org || companyNames.has(org) || loading.has(org)) return;
    loading.add(org);
    readCompany(client, org)
      .then((info) => companyNames.set(org, info.names))
      .catch(() => companyNames.set(org, new Map()))
      .finally(() => {
        loading.delete(org);
        listeners.forEach((l) => l());
      });
  }, [client, org]);
  return useCallback(
    (account: string | null | undefined) => (account && org ? companyNames.get(org)?.get(account) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org, companyNames.get(org ?? "")],
  );
}

/**
 * {@link personLabel} with the company-wide name filled in: a profile name is
 * per audience, the org member name is per person and shared by every audience
 * in the company.
 */
export function usePersonLabel(): (name: string, account: string) => string {
  const nameOf = useCompanyNames();
  return useCallback(
    (name: string, account: string) => personLabel(name, account, nameOf(account)),
    [nameOf],
  );
}

/**
 * Publish a profile name company-wide too (org member metadata), so every
 * audience shows it. Best-effort: the profile is what was asked for, and a
 * refusal here must not report it as failed.
 */
export function usePublishSpaceName(): (account: string, name: string) => void {
  const signedIn = useMaybeSignedIn();
  const client = signedIn?.client ?? null;
  return useCallback(
    (account: string, name: string) => {
      const org = getActiveNamespaceId();
      const trimmed = name.trim();
      if (!client || !org || !account || !trimmed) return;
      void client
        .setMemberMetadata(org, account, { name: trimmed })
        .then(() => {
          const names = new Map(companyNames.get(org) ?? []);
          names.set(account, trimmed);
          companyNames.set(org, names);
          listeners.forEach((l) => l());
        })
        .catch(() => {});
    },
    [client],
  );
}

/** The name `account` set for the whole company, or "" when none is known. */
export function useSpaceName(account: string | null | undefined): string {
  return useCompanyNames()(account) ?? "";
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
