import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import type { OrgBackend } from "../backend";
import { debounce } from "./debounce";
import { execute, type ExecuteResult } from "./execute";
import { observeApp } from "./observe";
import { plan } from "./plan";
import type { ObservedApp } from "./types";

/** The safety net: changes in app namespaces, and retries of failed ops, raise no org event. */
const PERIOD_MS = 60_000;
/** A burst of org changes (one admin action is several writes) is reconciled once. */
const CHANGE_DEBOUNCE_MS = 1_000;

/**
 * Runs plan → execute while an admin's tab is open: on every change to the org
 * (`changes`), on a slow timer, and on demand. Each tab reconciles only the apps
 * whose namespace its account administers. One run at a time; a run requested
 * mid-run queues one more. A run's own writes are changes too, so a run that
 * wrote anything is followed by one that finds nothing to do.
 */
export function useReconciler(backend: OrgBackend | null, orgNamespaceId: string, enabled: boolean, myAccount: string, changes: number) {
  const { admin } = useMero();
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<ExecuteResult | null>(null);
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const again = useRef(false);

  const runNow = useCallback(async () => {
    if (!backend || !admin || !enabled || !myAccount) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true; setRunning(true);
    try {
      do {
        again.current = false;
        const [placements, enrolments, groups, allApps, members, org] = await Promise.all([backend.desiredPlacements(), backend.enrolments(), backend.groups(), backend.apps(), backend.members(), backend.org()]);
        const apps = allApps.filter((x) => x.status === "ready" && x.admin_account === myAccount);
        const observed: ObservedApp[] = [];
        for (const a of apps) {
          try { observed.push(await observeApp(admin, a.id, orgNamespaceId)); } catch (e) { console.warn("mero-org reconciler: observe failed, skipping app this round", a.id, e); }
        }
        let orgRootMembers = new Set<string>();
        try { orgRootMembers = new Set((await admin.listGroupMembers(orgNamespaceId)).members.map((m) => m.identity)); } catch (e) { console.warn("mero-org reconciler: could not list the org namespace members", e); }
        const leftAccounts = members.filter((m) => m.status === "left").map((m) => m.account);
        // Where members' nodes follow from. Unread (an older node, a blip) leaves the stored addresses be.
        let peerAddrs: string[] | null = null;
        try { peerAddrs = (await admin.getNodeIdentity()).externalAddrs ?? null; } catch (e) { console.warn("mero-org reconciler: could not read this node's addresses", e); }
        const ops = plan({ orgNamespaceId, now: Date.now(), placements, enrolments, groups, apps, observed, leftAccounts, orgRootMembers, orgAdmins: org.admins, peerAddrs });
        const result = ops.length ? await execute(ops, admin, backend, orgNamespaceId) : { applied: 0, failed: [] };
        setLastResult(result); setLastRun(Date.now());
      } while (again.current);
    } finally { busy.current = false; setRunning(false); }
  }, [backend, admin, enabled, orgNamespaceId, myAccount]);

  useEffect(() => { if (!enabled) return; void runNow(); const t = setInterval(() => void runNow(), PERIOD_MS); return () => clearInterval(t); }, [enabled, runNow]);

  // Every org change, from any admin on any node, once it reaches this tab's node.
  const latest = useRef(runNow);
  latest.current = runNow;
  const kick = useMemo(() => debounce(() => void latest.current(), CHANGE_DEBOUNCE_MS), []);
  useEffect(() => () => kick.cancel(), [kick]);
  const seen = useRef(changes);
  useEffect(() => {
    if (changes === seen.current) return;
    seen.current = changes;
    if (enabled) kick();
  }, [changes, enabled, kick]);

  return { lastRun, lastResult, running, runNow };
}
