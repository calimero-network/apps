import { useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import LandingPage from "./pages/landing/LandingPage";
import { OrgPicker } from "./OrgPicker";
import { useOrg, useOrgContext } from "./useOrg";

const KEY = "mero-org:context";
function readPick(): { contextId: string; namespaceId: string } | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function App() {
  const { isAuthenticated, isLoading } = useMero();
  const [pick, setPick] = useState(readPick);
  if (isLoading) return <div className="empty">Connecting…</div>;
  if (!isAuthenticated) return <LandingPage />;
  if (!pick) return <OrgPicker onPick={(contextId, namespaceId) => { localStorage.setItem(KEY, JSON.stringify({ contextId, namespaceId })); setPick({ contextId, namespaceId }); }} />;
  return <OrgApp contextId={pick.contextId} namespaceId={pick.namespaceId} />;
}

function OrgApp({ contextId }: { contextId: string; namespaceId: string }) {
  const { backend, nudge } = useOrgContext(contextId);
  if (!backend) return <div className="empty">Connecting…</div>;
  return <Loaded backend={backend} nudge={nudge} />;
}

function Loaded({ backend, nudge }: { backend: NonNullable<ReturnType<typeof useOrgContext>["backend"]>; nudge: number }) {
  const state = useOrg(backend, nudge);
  return <pre>{JSON.stringify(state.org, null, 2)}</pre>; // replaced by the router in Task 10
}
