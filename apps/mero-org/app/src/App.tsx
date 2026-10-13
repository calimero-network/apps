import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import LandingPage from "./pages/landing/LandingPage";
import { OrgPicker } from "./OrgPicker";
import { useOrg, useOrgContext } from "./useOrg";
import type { OrgBackend } from "./backend";
import { readPick, writePick, type OrgPick } from "./pick";
import { Shell, type PageProps } from "./pages/Shell";
import { JoinPage } from "./pages/JoinPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PersonPage } from "./pages/PersonPage";
import { GroupsPage } from "./pages/GroupsPage";
import { AppsPage } from "./pages/AppsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { MePage } from "./pages/MePage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Outside the Gate: an invitee arrives signed out and with no org picked. */}
        <Route path="/join" element={<JoinPage />} />
        <Route path="/docs" element={<LandingPage />} />
        <Route path="/preview" element={<LandingPage />} />
        <Route path="/*" element={<Gate />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Connected → an org picked → the org's screens. */
function Gate() {
  const { isAuthenticated, isLoading } = useMero();
  const [pick, setPick] = useState<OrgPick | null>(readPick);
  const choose = (p: OrgPick | null) => { writePick(p); setPick(p); };
  if (isLoading) return <div className="empty">Connecting…</div>;
  if (!isAuthenticated) return <LandingPage />;
  if (!pick) return <OrgPicker onPick={(contextId, namespaceId) => choose({ contextId, namespaceId })} />;
  return <OrgApp key={pick.contextId} pick={pick} onSwitchOrg={() => choose(null)} />;
}

function OrgApp({ pick, onSwitchOrg }: { pick: OrgPick; onSwitchOrg: () => void }) {
  const { backend, nudge } = useOrgContext(pick.contextId);
  if (!backend) return <div className="empty">Connecting…</div>;
  return <Loaded backend={backend} nudge={nudge} orgNamespaceId={pick.namespaceId} onSwitchOrg={onSwitchOrg} />;
}

/** The signed-in account, read once: admins are listed by account, and so are members. */
function useMyAccount(): string | null {
  const { admin } = useMero();
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    if (!admin) return;
    let live = true;
    admin.getNodeIdentity().then((id) => { if (live) setAccount(id.accountId); }, (e: unknown) => { console.warn("mero-org: could not read the node identity", e); if (live) setAccount(""); });
    return () => { live = false; };
  }, [admin]);
  return account;
}

function Loaded({ backend, nudge, orgNamespaceId, onSwitchOrg }: { backend: OrgBackend; nudge: number; orgNamespaceId: string; onSwitchOrg: () => void }) {
  const state = useOrg(backend, nudge);
  const myAccount = useMyAccount();
  const ready = myAccount !== null && state.org !== null;
  const isAdmin = !!myAccount && !!state.org?.admins.includes(myAccount);
  const props: PageProps = { state, orgNamespaceId, myAccount: myAccount ?? "", isAdmin };

  return (
    <Shell {...props} onSwitchOrg={onSwitchOrg}>
      <Routes>
        <Route path="people" element={<PeoplePage {...props} />} />
        <Route path="people/:account" element={<PersonPage {...props} />} />
        <Route path="groups" element={<GroupsPage {...props} />} />
        <Route path="apps" element={<AppsPage {...props} />} />
        <Route path="activity" element={<ActivityPage {...props} />} />
        <Route path="me" element={<MePage {...props} />} />
        <Route path="settings" element={<SettingsPage {...props} />} />
        {/* Wait for the org and the account before choosing a landing page, or an admin is sent to /me. */}
        <Route path="*" element={ready ? <Navigate to={isAdmin ? "/people" : "/me"} replace /> : <div className="empty">Loading the org…</div>} />
      </Routes>
    </Shell>
  );
}
