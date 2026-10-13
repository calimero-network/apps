import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMero, useSubscription } from "@calimero-network/mero-react";
import type { SubscriptionEventData } from "@calimero-network/mero-react";
import { MeroOrgClient } from "./generated/MeroOrgClient";
import { nodeBackend, type AccessView, type AppView, type EnrolmentView, type GroupView, type MemberView, type OrgBackend, type OrgView } from "./backend";

const POLL_MS = 15_000;

export interface OrgState {
  org: OrgView | null; members: MemberView[]; groups: GroupView[]; apps: AppView[]; access: AccessView[]; enrolments: EnrolmentView[];
  error: string | null; busy: boolean; backend: OrgBackend;
  /** Bumped on every event on the org context and after every mutation from this tab. */
  changes: number;
  refresh: () => Promise<void>;
  /** Run a mutation, then re-read. Returns null (and sets `error`) on failure. */
  run: <T>(f: (b: OrgBackend) => Promise<T>) => Promise<T | null>;
  dismissError: () => void;
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useOrg(backend: OrgBackend, nudge: number): OrgState {
  const [org, setOrg] = useState<OrgView | null>(null);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [apps, setApps] = useState<AppView[]>([]);
  const [access, setAccess] = useState<AccessView[]>([]);
  const [enrolments, setEnrolments] = useState<EnrolmentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reading = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (reading.current) { again.current = true; return; }
    reading.current = true;
    try {
      do {
        again.current = false;
        const [o, m, g, a, ac, e] = await Promise.all([backend.org(), backend.members(), backend.groups(), backend.apps(), backend.accessRows(), backend.enrolments()]);
        setOrg(o); setMembers(m); setGroups(g); setApps(a); setAccess(ac); setEnrolments(e);
      } while (again.current);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      reading.current = false;
    }
  }, [backend]);

  useEffect(() => { void refresh(); }, [refresh, nudge]);
  useEffect(() => { const t = setInterval(() => void refresh(), POLL_MS); return () => clearInterval(t); }, [refresh]);

  // Our own writes count as changes even before their event arrives.
  const [mutations, setMutations] = useState(0);
  const run = useCallback(async <T,>(f: (b: OrgBackend) => Promise<T>): Promise<T | null> => {
    setBusy(true);
    try {
      const out = await f(backend);
      setMutations((n) => n + 1);
      await refresh();
      return out;
    } catch (e) {
      setError(messageOf(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [backend, refresh]);

  return { org, members, groups, apps, access, enrolments, error, busy, backend, changes: nudge + mutations, refresh, run, dismissError: () => setError(null) };
}

/** The backend for the org context, plus a counter bumped on every event on it. */
export function useOrgContext(contextId: string): { backend: OrgBackend | null; nudge: number } {
  const { mero } = useMero();
  const backend = useMemo(() => (mero ? nodeBackend(new MeroOrgClient(mero, contextId)) : null), [mero, contextId]);
  const [nudge, setNudge] = useState(0);
  const ids = useMemo(() => [contextId], [contextId]);
  useSubscription(ids, useCallback((event: SubscriptionEventData) => { if ("contextId" in event && event.contextId === contextId) setNudge((n) => n + 1); }, [contextId]));
  return { backend, nudge };
}
