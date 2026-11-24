import { useEffect, useState } from "react";
import { AppListing, NativeApproval, NodeShield, SignInPanel } from "@calimero-apps/passkey";
import { finishNativeSignIn, pendingNativeApproval, pendingNativeSignIn, type NativeApprovalRequest } from "@calimero-apps/passkey/native";
import "@calimero-apps/passkey/passkey.css";

import { APPROVE_CALLBACK, APP_NAME, LISTING, ONBOARDING, SIGN_IN_CALLBACK, defaultDeps, useSession, type SessionDeps } from "./session";

/**
 * Mero Tag's served page. The app is the iOS client; this page only does what
 * a native app can't do itself on Calimero Cloud: sign the person in from Mero
 * Tag's own origin (so the session is bound to the package) and hand the
 * session back sealed (`#native-sign-in`), approve a step-up with the passkey
 * (`#native-approve`), and pass the node's consent decision back
 * (`?native-consent=1`, in main.tsx). The hand-offs are `@calimero-apps/passkey/native`.
 */
export function App({
  deps = defaultDeps,
  approval = pendingNativeApproval(),
  go,
}: {
  deps?: SessionDeps;
  /** A passkey approval the app asked for; the captured one unless a test passes one. */
  approval?: NativeApprovalRequest | null;
  /** Where the page sends the person back to the app; `location.assign` unless a test passes one. */
  go?: (url: string) => void;
}) {
  if (approval) return <NativeApproval appName={APP_NAME} callback={APPROVE_CALLBACK} request={approval} go={go} />;
  return <Session deps={deps} go={go} />;
}

function Session({ deps, go }: { deps: SessionDeps; go?: (url: string) => void }) {
  const api = useSession(deps);
  const { session, store } = api;
  const native = pendingNativeSignIn() !== null;
  const [handoff, setHandoff] = useState<"idle" | "sending" | string>("idle");

  // Signed in with a sign-in the app asked for: seal the session to the app's
  // key, send it back and forget it here (no sign-out: that would end the app's
  // session too).
  const client = session.status === "signed-in" ? session.client : null;
  useEffect(() => {
    if (!client || !native) return;
    setHandoff("sending");
    finishNativeSignIn({ client, callback: SIGN_IN_CALLBACK, forgetHere: () => store?.clear(), go }).catch((e: unknown) =>
      setHandoff(e instanceof Error ? e.message : String(e)),
    );
  }, [client, native, store, go]);

  return (
    <main className="shell">
      <header className="brand">
        <img src="./icon.svg" alt="" width={36} height={36} />
        <h1>{APP_NAME}</h1>
      </header>

      {session.status === "connecting" && <p className="dim">Connecting…</p>}

      {session.status === "listing" && <AppListing {...LISTING} />}

      {session.status === "unconfigured" && (
        <section className="card glass-surface">
          <h2>Cannot connect</h2>
          <p className="err">{session.message}</p>
        </section>
      )}

      {session.status === "signed-out" &&
        (native ? (
          <section className="card glass-surface" data-testid="signin-page">
            <SignInPanel
              {...ONBOARDING}
              api={api}
              invited={false}
              before={<p className="dim">{APP_NAME} on your iPhone asked you to sign in. You go back to it once you have.</p>}
            />
          </section>
        ) : (
          <section className="card glass-surface" data-testid="intro">
            <h2>Live location, on your own cluster</h2>
            <p className="dim">
              {APP_NAME} shares live location with the people you choose, kept by your organization&apos;s Calimero
              cluster. It is an iPhone app: open {APP_NAME} on your iPhone to sign in.
            </p>
          </section>
        ))}

      {session.status === "signed-in" && native && (
        <section className="card glass-surface" data-testid="handoff">
          {handoff === "idle" || handoff === "sending" ? (
            <p className="dim">Returning you to {APP_NAME}…</p>
          ) : (
            <p className="err" role="alert">
              {handoff}
            </p>
          )}
        </section>
      )}

      {session.status === "signed-in" && !native && (
        <section className="card glass-surface" data-testid="signed-in">
          <p className="dim">
            You&apos;re signed in. {APP_NAME} runs on your iPhone: open it there to see and share locations.
          </p>
          <footer className="row">
            <span className="row dim">
              <NodeShield /> account <code className="mono">{session.accountId.slice(0, 12)}…</code>
            </span>
            <button type="button" className="glass-btn" onClick={() => void api.signOut()}>
              Sign out
            </button>
          </footer>
        </section>
      )}
    </main>
  );
}
