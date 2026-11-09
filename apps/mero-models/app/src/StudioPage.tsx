import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  appSource,
  askAnOwnerCopy,
  canCreateIn,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";
import { ScenePicker } from "./ScenePicker";
import { PACKAGE } from "./meroModels";
import { SceneContext, type OpenedScene, type SceneSession } from "./scene";
import { instanceIn, listScenes, readSelection, selectionKey, writeSelection } from "./scenes";
import { AppListing, PasskeySignIn, InvitationSignIn, JoinInvitation, usePendingInvite } from "@calimero-apps/passkey";
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
  invites,
  landing,
  setLanding,
}: {
  api: SessionApi;
  deps: SessionDeps;
  storage: KeyValueStorage;
  /** The app's pending-invite store. */
  invites: InviteStore;
  /** The studio an invite joined (or the account was already in), to open once signed in. */
  landing: { org: string | null } | null;
  setLanding: (landing: { org: string | null } | null) => void;
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
  // is pending (`InvitationSignIn`), redeemed only on "Join" (`JoinInvitation`).
  // The store drops it once joined, refused or declined, and on sign-out.
  const pending = usePendingInvite(invites);
  // The invitation a signed-in account is asked about stays on screen until it
  // closes: `JoinInvitation` drops the token before it says "already in" or
  // "used up", and the store would take the page away with it.
  const [asked, setAsked] = useState<PendingInvite | null>(null);
  useEffect(() => {
    if (!client) setAsked(null);
    else if (pending) setAsked(pending);
  }, [client, pending]);
  const asking = client ? (pending ?? asked) : null;

  // The studio an invite joined (or the account was already in): its scene
  // (the one opened last when it is there) opens once there is a client.
  useEffect(() => {
    if (!client || !landing) return;
    setLanding(null);
    const { org } = landing;
    void (async () => {
      setPickerKey((k) => k + 1);
      const remembered = key ? readSelection(storage, key)?.appId : null;
      const found = org ? instanceIn(await listScenes(client, source).catch(() => []), org, remembered) : null;
      after();
      if (found) {
        open({ appId: found.appId, name: found.name, org: found.org });
        setNotice(null);
        return;
      }
      open(null);
      // In the studio, but with no scene there to open: say who may add one.
      const may = org ? await canCreateIn(client, org) : null;
      setNotice(may === false ? askAnOwnerCopy("a scene") : "Invitation accepted: the studio's scenes are in your list.");
    })();
  }, [client, landing, setLanding, source, key, storage, after, open]);

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
        {pending ? (
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

  if (asking) {
    return (
      <div className="page">
        <TopBar onHome={home} where={describeTarget(session.target)} onLogout={logout} />
        <main className="wrap">
          <JoinInvitation
            {...ONBOARDING}
            client={session.client}
            key={asking.token}
            token={asking.token}
            org={asking.org}
            drop={invites.drop}
            after={after}
            onJoined={({ org }) => {
              setAsked(null);
              setLanding({ org });
            }}
            onClose={({ member }) => {
              setAsked(null);
              if (member) setLanding({ org: member });
            }}
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
        <PasskeySignIn api={api} joining="the studio" />
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

