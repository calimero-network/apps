import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appSource, type KeyValueStorage } from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";
import { ScenePicker } from "./ScenePicker";
import { PACKAGE } from "./meroModels";
import { SceneContext, type OpenedScene, type SceneSession } from "./scene";
import { pendingInvite, readSelection, selectionKey, writeSelection, dropInvite, isSpentInvite, pendingInviteOrg } from "./scenes";
import { AppListing, PasskeySignIn, InvitationSignIn, JoinInvitation } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { ONBOARDING, LISTING, describeTarget, type SessionApi, type SessionDeps } from "./session";

/** Where this frontend's routes and assets live: `/`, or under the node's `/{version}/`. */
export const base = () => nodeBasename(new URL(window.location.href), "/");

/**
 * The modeller is three.js and most of this bundle; the landing page a stranger
 * opens first should not wait for it.
 */
const Studio = lazy(() => import("./studio/Studio").then((m) => ({ default: m.Studio })));

function Loading({ label }: { label: string }) {
  return (
    <div className="loading-state">
      <span className="spinner" aria-hidden="true" />
      <p className="empty">{label}</p>
    </div>
  );
}

/** Sign in, pick a scene, model. Three states — exactly the three things that can be missing. */
export function StudioPage({
  api,
  deps,
  storage,
}: {
  api: SessionApi;
  deps: SessionDeps;
  storage: KeyValueStorage;
}) {
  const { session, store } = api;
  const navigate = useNavigate();
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [opened, setOpened] = useState<OpenedScene | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const client = session.status === "signed-in" ? session.client : null;
  const key = session.status === "signed-in" ? selectionKey(session.target, session.accountId) : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The scene opened last time, on this target, by this account.
  useEffect(() => {
    setOpened(key ? readSelection(storage, key) : null);
  }, [key, storage]);

  const open = useCallback(
    (scene: OpenedScene | null) => {
      setOpened(scene);
      if (key) writeSelection(storage, key, scene);
    },
    [key, storage],
  );

  // An invitation link opened before signing in: a page of its own while it
  // is pending (see `Invitation.tsx`), redeemed only on "Join".
  const [invite, setInvite] = useState<string | null>(() => pendingInvite(storage));
  useEffect(() => {
    if (client) setInvite(pendingInvite(storage));
  }, [client, storage]);

  const logout = useCallback(() => {
    if (key) writeSelection(storage, key, null);
    setOpened(null);
    void api.signOut();
  }, [api, key, storage]);

  const scene: SceneSession | null = useMemo(
    () =>
      session.status === "signed-in" && opened
        ? {
            ...opened,
            client: session.client,
            accountId: session.accountId,
            after,
            passkey: deps.passkey,
            leave: () => open(null),
            logout,
          }
        : null,
    [session, opened, after, deps.passkey, open, logout],
  );

  if (session.status === "connecting") return <Loading label="Connecting…" />;

  const home = () => navigate("/", { state: { fromApp: true } });

  if (session.status === "unconfigured" || session.status === "listing") {
    return (
      <div className="page">
        <TopBar onHome={home} />
        <section className="connect">
          <div className="connect-card">
            {session.status === "listing" ? (
              <AppListing {...LISTING} />
            ) : (
              <>
                <h1>Not configured</h1>
                <pre className="err">{session.message}</pre>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (session.status === "signed-out") {
    return (
      <div className="page">
        <TopBar onHome={home} />
        {invite ? (
          <main className="wrap">
            {/* "Not now": the landing page, with the invitation kept for the next sign-in. */}
            <InvitationSignIn {...ONBOARDING} api={api} onLater={home} />
          </main>
        ) : (
          <SignIn api={api} where={describeTarget(session.target)} />
        )}
      </div>
    );
  }

  if (invite) {
    return (
      <div className="page">
        <TopBar onHome={home} where={describeTarget(session.target)} onLogout={logout} />
        <main className="wrap">
          <JoinInvitation
            {...ONBOARDING}
            client={session.client}
            token={invite}
            org={pendingInviteOrg(storage)}
            drop={() => dropInvite(storage)}
            isSpent={isSpentInvite}
            after={after}
            onJoined={() => {
              setInvite(null);
              setNotice("Invitation accepted: the studio's scenes are in your list.");
              setPickerKey((k) => k + 1);
              open(null);
            }}
            onClose={() => setInvite(null)}
          />
        </main>
      </div>
    );
  }

  if (!scene) {
    return (
      <div className="page">
        <TopBar onHome={home} where={describeTarget(session.target)} onLogout={logout} />
        <main className="wrap">
          <ScenePicker key={pickerKey} client={session.client} source={source} onOpen={open} after={after}>
            {notice && <p className="hint">{notice}</p>}
          </ScenePicker>
        </main>
      </div>
    );
  }

  return (
    <Suspense fallback={<Loading label="Loading the studio…" />}>
      <SceneContext.Provider value={scene}>
        {/* Keyed, so a scene opened in place starts from nothing of the last one's. */}
        <Studio key={scene.appId} contextId={scene.appId} />
      </SceneContext.Provider>
    </Suspense>
  );
}

/** The front door: a passkey sign-in, or a new account with a new passkey. */
function SignIn({ api, where }: { api: SessionApi; where: string }) {
  return (
    <section className="connect">
      <div className="connect-card">
        <img className="connect-mark" src={`${base()}favicon.svg`} alt="" />
        <h1>Sign in</h1>
        <p className="lede">
          Sign in, or create an account, to open your scenes. Your account is a passkey: nothing to remember,
          nothing to leak. Connected to {where}.
        </p>
        <PasskeySignIn api={api} />
        <ul className="connect-points">
          <li>Your scenes, shared only with your studio</li>
          <li>Real-time co-editing</li>
          <li>OBJ · STL · glTF in and out</li>
        </ul>
      </div>
    </section>
  );
}

function TopBar({ onHome, where, onLogout }: { onHome: () => void; where?: string; onLogout?: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="brand" onClick={onHome}>
          <img src={`${base()}favicon.svg`} alt="" width={26} height={26} />
          <span>Mero Models</span>
        </button>
        {onLogout && (
          <div className="session">
            <span className="node-pill" title={where ?? ""}>
              <span className="presence online" aria-hidden="true" />
              <span className="mono">{where ?? ""}</span>
            </span>
            <button className="ghost small" onClick={onLogout}>
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

