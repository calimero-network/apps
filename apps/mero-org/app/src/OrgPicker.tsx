import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { PACKAGE_NAME } from "./config";

export function OrgPicker({ onPick }: { onPick: (contextId: string, namespaceId: string) => void }) {
  const { admin, applicationId, can } = useMero();
  const [rows, setRows] = useState<{ contextId: string; namespaceId: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!admin || !applicationId) return;
    let live = true;
    (async () => {
      try {
        const namespaces = await admin.listNamespacesForApplication(applicationId);
        const out: typeof rows = [];
        for (const ns of namespaces) {
          const contexts = await admin.listGroupContexts(ns.namespaceId);
          for (const c of contexts) out.push({ contextId: c.contextId, namespaceId: ns.namespaceId, name: ns.name ?? ns.namespaceId.slice(0, 8) });
        }
        if (live) setRows(out);
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { live = false; };
  }, [admin, applicationId]);

  async function create() {
    if (!admin || !applicationId) return;
    setBusy(true);
    try {
      const ns = await admin.createNamespace({ applicationId, name: "org" });
      const ctx = await admin.createContext({ applicationId, groupId: ns.namespaceId, name: "org", initializationParams: [] });
      onPick(ctx.contextId, ns.namespaceId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <section className="picker">
      <h1>Mero Org</h1>
      {rows.map((r) => <button key={r.contextId} type="button" onClick={() => onPick(r.contextId, r.namespaceId)}>{r.name}</button>)}
      {rows.length === 0 && <p>No org on this {PACKAGE_NAME} install yet.</p>}
      {can.createNamespace && <button type="button" disabled={busy} onClick={() => void create()}>Create org</button>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
