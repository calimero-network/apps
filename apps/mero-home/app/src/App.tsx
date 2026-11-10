import { useCallback, useEffect, useMemo, useState } from "react";
import type { InviteStore, KeyValueStorage, PendingInvite } from "@calimero-apps/connect";
import { AppListing, InvitationSignIn, JoinInvitation, SignInPanel, usePendingInvite } from "@calimero-apps/passkey";

import { Home } from "./Home";
import { invites as homeInvites } from "./invites";
import { ONBOARDING, defaultDeps, describeTarget, useSession, type SessionDeps } from "./session";

/** The org named in the page's `?org=`: where "Manage people in Calimero Home" links land. */
function orgFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("org");
  } catch {
    return null;
  }
}

export function App({
  deps = defaultDeps,
  storage = globalThis.localStorage,
  invites = homeInvites,
  initialOrg = orgFromUrl(),
}: {
  deps?: SessionDeps;
  storage?: KeyValueStorage;
  invites?: InviteStore;
  /** The org to open first (the page's `?org=`). */
  initialOrg?: string | null;
}) {
  const sessionDeps = useMemo(
    () => (storage === deps.storage || !storage ? deps : { ...deps, storage }),
    [deps, storage],
  );
  const [landing, setLanding] = useState<string | null>(initialOrg);
  const api = useSession(sessionDeps, invites, (joined, pending) => setLanding(joined.org ?? pending?.org ?? null));
  const { session, store } = api;
  const client = session.status === "signed-in" ? session.client : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // An invitation link: its own page while signed out, "Join" once signed in.
  const pending = usePendingInvite(invites);
  const [asked, setAsked] = useState<PendingInvite | null>(null);
  useEffect(() => {
    if (!client) setAsked(null);
    else if (pending) setAsked(pending);
  }, [client, pending]);
  const asking = client ? (pending ?? asked) : null;
  const [inviteLater, setInviteLater] = useState(false);

  return (
    <div className="home glass-fields">
      <header className="home-header glass-header">
        <h1>Calimero Home</h1>
        <p className="home-muted">Your organizations, their apps, and who is in each.</p>
      </header>

      <main className="home-main">
        {session.status === "connecting" && (
          <section className="home-card">
            <p className="home-muted">Connecting…</p>
          </section>
        )}

        {session.status === "listing" && (
          <section className="home-card">
            <AppListing {...ONBOARDING.listing} />
          </section>
        )}

        {session.status === "unconfigured" && (
          <section className="home-card">
            <h2>Cannot connect</h2>
            <pre className="home-error">{session.message}</pre>
          </section>
        )}

        {session.status === "signed-out" &&
          (pending?.token && !inviteLater ? (
            <InvitationSignIn {...ONBOARDING} api={api} onLater={() => setInviteLater(true)} />
          ) : (
            <section className="home-card" data-testid="signin-page">
              <SignInPanel {...ONBOARDING} api={api} invited={false} />
            </section>
          ))}

        {session.status === "signed-in" && asking && (
          <JoinInvitation
            {...ONBOARDING}
            key={asking.token}
            client={session.client}
            token={asking.token}
            org={asking.org}
            drop={invites.drop}
            after={after}
            onJoined={({ org }) => {
              setAsked(null);
              if (org) setLanding(org);
            }}
            onClose={({ member }) => {
              setAsked(null);
              if (member) setLanding(member);
            }}
          />
        )}

        {session.status === "signed-in" && !asking && (
          <Home
            client={session.client}
            account={session.accountId}
            passkey={deps.passkey}
            after={after}
            initialOrg={landing}
            storage={storage}
          />
        )}
      </main>

      {session.status === "signed-in" && (
        <footer className="home-row home-footer">
          <span className="home-muted">
            {describeTarget(session.target)} · account <code>{session.accountId}</code>
          </span>
          <button className="glass-btn" onClick={() => void api.signOut()}>
            Sign out
          </button>
        </footer>
      )}
    </div>
  );
}
