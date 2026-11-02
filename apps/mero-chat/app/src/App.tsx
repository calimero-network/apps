import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { appSource } from "@calimero-apps/connect";

import { PACKAGE } from "./calimero/chat";
import { setConnection } from "./calimero/connection";
import { clearRegistry } from "./calimero/registry";
import { defaultDeps, describeTarget, useSession, type SessionDeps } from "./calimero/session";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { ToastManager } from "./components/common/ToastManager";
import { clearGroupId, getGroupId, setGroupId } from "./constants/config";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import SignInPage, { Card, Center } from "./pages/SignIn";
import Workspaces from "./pages/Workspaces";

const Home = lazy(() => import("./pages/Home"));
const Landing = lazy(() => import("./pages/landing/LandingPage"));

function ToastDisplay() {
  const { toasts, removeToast } = useToast();
  return <ToastManager toasts={toasts} onRemoveToast={removeToast} />;
}

/**
 * Signed out: the landing page and the passkey sign-in. Signed in: the
 * workspace picker until a workspace (an organization) is open, then the chat.
 * The client connects to the local nodes under `vite` and to the Calimero
 * Cloud cluster in a production build (`@calimero-apps/connect`).
 */
export default function App({ deps = defaultDeps }: { deps?: SessionDeps }) {
  const api = useSession(deps);
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [workspace, setWorkspace] = useState<string>(getGroupId());

  const client = session.status === "signed-in" ? session.client : null;
  const accountId = session.status === "signed-in" ? session.accountId : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The connection the data layer outside React reads: set before children render.
  const ready = useMemo(() => {
    if (!client || !accountId) {
      setConnection(null);
      clearRegistry();
      return false;
    }
    setConnection({ client, accountId, source, passkey: deps.passkey, after });
    return true;
  }, [client, accountId, source, deps.passkey, after]);

  useEffect(() => {
    if (session.status === "signed-out") {
      clearGroupId();
      setWorkspace("");
    }
  }, [session.status]);

  const open = useCallback((org: string) => {
    if (org) setGroupId(org);
    else clearGroupId();
    setWorkspace(org);
  }, []);

  let body: React.ReactNode;
  if (session.status === "connecting") {
    body = <LoadingSpinner />;
  } else if (session.status === "unconfigured") {
    body = (
      <Center>
        <Card>
          <h2>Cannot connect</h2>
          <pre className="err">{session.message}</pre>
        </Card>
      </Center>
    );
  } else if (session.status === "signed-out") {
    body = <SignInPage api={api} where={describeTarget(session.target)} />;
  } else if (!ready) {
    body = <LoadingSpinner />;
  } else if (!workspace) {
    body = <Workspaces onOpen={open} onSignOut={() => void api.signOut()} />;
  } else {
    body = (
      <Home
        key={`${accountId}:${workspace}`}
        org={workspace}
        onLeaveWorkspace={() => open("")}
        onSignOut={() => void api.signOut()}
      />
    );
  }

  return (
    <ToastProvider>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/docs" element={<Landing />} />
          <Route path="/preview" element={<Landing />} />
          <Route path="*" element={body} />
        </Routes>
        <ToastDisplay />
      </Suspense>
    </ToastProvider>
  );
}
