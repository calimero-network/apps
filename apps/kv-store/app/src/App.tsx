import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppInfo } from "@calimero-network/mero-js";
import {
  appSource,
  askAnOwnerCopy,
  canCreateIn,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
import { AppListing, InvitationSignIn, JoinInvitation, SignInPanel, usePendingInvite, useInstanceRelease } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";

import { KvStoreClient } from "./generated/client";
import { InviteCard } from "./InviteCard";
import { KvPanel } from "./KvPanel";
import { StorePicker } from "./StorePicker";
import { LISTING, ONBOARDING, PACKAGE, defaultDeps, describeTarget, useSession, type SessionDeps } from "./session";
import { instanceIn, invites as appInvites, listStores, selectionKey } from "./stores";

type Opened = Pick<AppInfo, "appId" | "name" | "org">;

function readSelection(storage: KeyValueStorage, key: string): Opened | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as Opened).appId === "string") {
      return parsed as Opened;
    }
  } catch {
    /* nothing usable stored */
  }
  return null;
}

/** Calls `onChange` (at most every 200 ms) for each event of the store, until the returned stop. */
function subscribeTo(kv: KvStoreClient) {
  return (onChange: () => void) => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        for await (const _event of kv.events(0, abort.signal)) {
          clearTimeout(timer);
          timer = setTimeout(onChange, 200);
        }
      } catch {
        // Stream closed (sign-out, app left, network): the Refresh button still works.
      }
    })();
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  };
}

export function App({
  deps = defaultDeps,
  storage = globalThis.localStorage,
  invites = appInvites,
}: {
  deps?: SessionDeps;
  storage?: KeyValueStorage;
  /** The pending-invite store; the module's own unless a test passes one. */
  invites?: InviteStore;
}) {
  // Memoised: a new object every render would reconnect every render.
  const sessionDeps = useMemo(
    () => (storage === deps.storage || !storage ? deps : { ...deps, storage }),
    [deps, storage],
  );
  // Signed up with the invite: the account is in the store's org already,
  // which opens once the session is signed in.
  const api = useSession(sessionDeps, invites, (joined, pending) =>
    setLanding({ org: joined.org ?? pending?.org ?? null }),
  );
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const client = session.status === "signed-in" ? session.client : null;
  // A store is an app instance, served the frontend of the release it runs.
  useInstanceRelease(client, opened?.appId);
  const key = session.status === "signed-in" ? selectionKey(session.target, session.accountId) : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The store opened last time, on this target, by this account.
  useEffect(() => {
    setOpened(key ? readSelection(storage, key) : null);
  }, [key, storage]);

  const open = useCallback(
    (app: Opened | null) => {
      setOpened(app);
      if (!key) return;
      try {
        if (app) storage.setItem(key, JSON.stringify({ appId: app.appId, name: app.name, org: app.org }));
        else storage.removeItem(key);
      } catch {
        /* remembered for this page only */
      }
    },
    [key, storage],
  );

  // An invitation link opened before signing in: a page of its own while it
  // is pending (`InvitationSignIn`), redeemed only on "Join" (`JoinInvitation`).
  // The store drops it once joined, refused or declined, and on sign-out.
  const pending = usePendingInvite(invites);
  const invite = pending?.token ?? null;
  // The invitation a signed-in account is asked about stays on screen until it
  // closes: `JoinInvitation` drops the token before it says "already in" or
  // "used up", and the store would take the page away with it.
  const [asked, setAsked] = useState<PendingInvite | null>(null);
  useEffect(() => {
    if (!client) setAsked(null);
    else if (pending) setAsked(pending);
  }, [client, pending]);
  const asking = client ? (pending ?? asked) : null;
  const [inviteLater, setInviteLater] = useState(false);

  // The org an invite joined (or the account was already in): its store opens
  // once there is a client to list it with. `org: null` when nothing said which.
  const [landing, setLanding] = useState<{ org: string | null } | null>(null);
  useEffect(() => {
    if (!client || !landing) return;
    setLanding(null);
    const { org } = landing;
    void (async () => {
      setPickerKey((k) => k + 1);
      const remembered = key ? readSelection(storage, key)?.appId : null;
      const found = org ? instanceIn(await listStores(client, source).catch(() => []), org, remembered) : null;
      after();
      if (found) {
        open(found);
        setNotice(null);
        return;
      }
      open(null);
      // In the org, but with no store there to open: say who may add one.
      const may = org ? await canCreateIn(client, org) : null;
      setNotice(may === false ? askAnOwnerCopy("a store") : "Invitation accepted: the shared store is in your list.");
    })();
  }, [client, landing, source, key, storage, after, open]);

  // The store's contract, through the client `mero-app-build codegen` generated
  // from logic/res/abi.json; `after` keeps the stored session current.
  const kv = useMemo(
    () => (client && opened ? new KvStoreClient(client, opened.appId, { after }) : null),
    [client, opened, after],
  );
  const subscribe = useMemo(() => (kv ? subscribeTo(kv) : undefined), [kv]);

  return (
    <div className="wrap">
      <header>
        <h1>KV Store</h1>
        <p className="sub">
          The reference Calimero app: a string key-value store in a WebAssembly component, every
          write ordered by the cluster&apos;s log, called through mero-js.
        </p>
      </header>

      {session.status === "connecting" && (
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      )}

      {session.status === "listing" && (
        <div className="card">
          <AppListing {...LISTING} />
        </div>
      )}

      {session.status === "unconfigured" && (
        <div className="card">
          <h2>Cannot connect</h2>
          <pre className="err">{session.message}</pre>
        </div>
      )}

      {session.status === "signed-out" &&
        (invite && !inviteLater ? (
          <InvitationSignIn {...ONBOARDING} api={api} onLater={() => setInviteLater(true)} />
        ) : (
          <section className="card" data-testid="signin-page">
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
            setLanding({ org });
          }}
          onClose={({ member }) => {
            setAsked(null);
            if (member) setLanding({ org: member });
          }}
        />
      )}

      {notice && (
        <div className="card">
          <p className="empty">{notice}</p>
        </div>
      )}

      {session.status === "signed-in" && !asking && !opened && (
        <StorePicker key={pickerKey} client={session.client} source={source} onOpen={open} after={after} />
      )}

      {session.status === "signed-in" && !asking && opened && kv && (
        <>
          <div className="card context-bar">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="empty">
                Store <strong>{opened.name}</strong> <code className="mono">{opened.appId}</code>
              </span>
              <button className="ghost" onClick={() => open(null)}>
                Change store
              </button>
            </div>
          </div>
          <KvPanel key={opened.appId} kv={kv} subscribe={subscribe} />
          <InviteCard
            key={`invite-${opened.appId}`}
            client={session.client}
            org={opened.org}
            passkey={deps.passkey}
            after={after}
          />
        </>
      )}

      {session.status === "signed-in" && (
        <footer className="row" style={{ justifyContent: "space-between", marginTop: 24 }}>
          <span className="empty">
            {describeTarget(session.target)} · account <code className="mono">{session.accountId}</code>
          </span>
          <button className="ghost" onClick={() => void api.signOut()}>
            Sign out
          </button>
        </footer>
      )}
    </div>
  );
}
