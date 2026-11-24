import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppListing, NativeApproval, NodeShield, SignInPanel } from "@calimero-apps/passkey";
import { finishNativeSignIn, type NativeApprovalRequest } from "@calimero-apps/passkey/native";

import {
  APP_NAME,
  APPROVED_CALLBACK,
  LISTING,
  ONBOARDING,
  SIGNED_IN_CALLBACK,
  defaultDeps,
  memoryStorage,
  useSession,
  type SessionDeps,
} from "./session";

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="ar-page glass-fields">
      <header className="ar-brand">
        <img className="ar-mark" src="./icon-512.png" alt="" width={44} height={44} />
        <span className="ar-name">{APP_NAME}</span>
      </header>
      {children}
      <p className="ar-foot">Every node is attested before this page talks to it. Your rooms stay on your cluster.</p>
    </main>
  );
}

/**
 * Sign in or create an account with a passkey. Opened by the iOS app
 * (`#native-sign-in`), the session goes back to it and is not kept here;
 * opened directly, it is this browser's session and the page says where Mero
 * AR runs.
 */
function SignIn({ deps, native, go }: { deps: SessionDeps; native: boolean; go?: (url: string) => void }) {
  const sessionDeps = useMemo(() => (native ? { ...deps, storage: memoryStorage() } : deps), [deps, native]);
  const api = useSession(sessionDeps);
  const { session, store } = api;
  const [handedOff, setHandedOff] = useState(false);

  const client = session.status === "signed-in" ? session.client : null;
  useEffect(() => {
    if (!native || !client) return;
    setHandedOff(true);
    void finishNativeSignIn({
      client,
      callback: SIGNED_IN_CALLBACK,
      forgetHere: () => store?.clear(),
      ...(go ? { go } : {}),
    });
  }, [native, client, store, go]);

  if (native && (handedOff || session.status === "signed-in")) {
    return (
      <section className="ar-panel" data-testid="handoff">
        <h1 className="ar-title">Back to {APP_NAME}</h1>
        <p className="ar-text">You're signed in. Returning to the app…</p>
      </section>
    );
  }

  switch (session.status) {
    case "connecting":
      return (
        <section className="ar-panel">
          <p className="ar-text">Connecting to your cluster…</p>
        </section>
      );
    case "listing":
      return (
        <section className="ar-panel">
          <AppListing {...LISTING} />
        </section>
      );
    case "unconfigured":
      return (
        <section className="ar-panel">
          <h1 className="ar-title">Can't reach the cluster</h1>
          <p className="ar-error" role="alert">
            {session.message}
          </p>
        </section>
      );
    case "signed-out":
      return (
        <section className="ar-panel" data-testid="signin-page">
          <SignInPanel
            {...ONBOARDING}
            api={api}
            invited={false}
            title={native ? `Sign in to ${APP_NAME}` : undefined}
          />
        </section>
      );
    case "signed-in":
      return (
        <section className="ar-panel" data-testid="signed-in">
          <h1 className="ar-title">You're signed in</h1>
          <p className="ar-text">
            {APP_NAME} runs on your iPhone: open the app there to scan a room and edit it with the people in your
            home. This page only signs the app in.
          </p>
          <div className="ar-actions">
            <NodeShield />
            <button type="button" className="glass-btn" onClick={() => void api.signOut()}>
              Sign out
            </button>
          </div>
        </section>
      );
  }
}

export function App({
  deps = defaultDeps,
  nativeSignIn = false,
  approval = null,
  go,
}: {
  deps?: SessionDeps;
  /** The iOS app opened this page to sign in (`#native-sign-in`). */
  nativeSignIn?: boolean;
  /** The iOS app opened this page to approve a change (`#native-approve`). */
  approval?: NativeApprovalRequest | null;
  go?: (url: string) => void;
}) {
  return (
    <Shell>
      {approval ? (
        <NativeApproval appName={APP_NAME} callback={APPROVED_CALLBACK} request={approval} go={go} />
      ) : (
        <SignIn deps={deps} native={nativeSignIn} go={go} />
      )}
    </Shell>
  );
}
