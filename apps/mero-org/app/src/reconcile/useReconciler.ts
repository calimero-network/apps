import { useCallback, useEffect, useRef, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import type { OrgBackend } from "../backend";
import { execute, type ExecuteResult } from "./execute";
import { observeApp } from "./observe";
import { plan } from "./plan";
import type { ObservedApp } from "./types";

const PERIOD_MS = 30_000;

/** Runs plan → execute while the admin's tab is open. One run at a time; a run requested mid-run queues one more. */
export function useReconciler(backend: OrgBackend | null, orgNamespaceId: string, enabled: boolean) {
  const { admin } = useMero();
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<ExecuteResult | null>(null);
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const again = useRef(false);

  const runNow = useCallback(async () => {
    if (!backend || !admin || !enabled) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true; setRunning(true);
    try {
      do {
        again.current = false;
        const [placements, enrolments, groups, apps, members] = await Promise.all([backend.desiredPlacements(), backend.enrolments(), backend.groups(), backend.apps(), backend.members()]);
        const observed: ObservedApp[] = [];
        for (const a of apps.filter((x) => x.status === "ready")) {
          try { observed.push(await observeApp(admin, a.id)); } catch (e) { console.warn("mero-org reconciler: observe failed, skipping app this round", a.id, e); }
        }
        const leftAccounts = members.filter((m) => m.status === "left").map((m) => m.account);
        const ops = plan({ orgNamespaceId, now: Date.now(), placements, enrolments, groups, apps, observed, leftAccounts });
        const result = ops.length ? await execute(ops, admin, backend, orgNamespaceId) : { applied: 0, failed: [] };
        setLastResult(result); setLastRun(Date.now());
      } while (again.current);
    } finally { busy.current = false; setRunning(false); }
  }, [backend, admin, enabled, orgNamespaceId]);

  useEffect(() => { if (!enabled) return; void runNow(); const t = setInterval(() => void runNow(), PERIOD_MS); return () => clearInterval(t); }, [enabled, runNow]);

  return { lastRun, lastResult, running, runNow };
}
