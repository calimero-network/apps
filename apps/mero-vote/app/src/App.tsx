import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { appSource, type KeyValueStorage } from "@calimero-apps/connect";
import { AppListing, PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { GroupPicker, type OpenedGroup } from "./GroupPicker";
import { InvitationSignIn, JoinInvitation } from "./Invitation";
import { InviteCard } from "./InviteCard";
import { PACKAGE, meroVote } from "./meroVote";
import { LISTING, defaultDeps, describeTarget, useSession, type SessionApi, type SessionDeps } from "./session";
import { pendingInvite, selectionKey } from "./groups";
import { VotePanel } from "./VotePanel";
import { ThemeToggle } from "./ThemeToggle";
import { signOut } from "./signOut";
import { VoteGroupContext, type VoteGroup } from "./useMeroVote";
import {
  BarChartIcon,
  BoxIcon,
  CheckIcon,
  ChevronRightIcon,
  KeyIcon,
  LayersIcon,
  LinkIcon,
  LockIcon,
  LogOutIcon,
  ServerIcon,
  ShieldCheckIcon,
  SwitchIcon,
  UserPlusIcon,
  VoteIcon,
} from "./icons";
import { Callout, IconTile, IdField, shortId } from "./ui";

function readSelection(storage: KeyValueStorage, key: string): OpenedGroup | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as OpenedGroup).appId === "string") {
      return parsed as OpenedGroup;
    }
  } catch {
    /* nothing usable stored */
  }
  return null;
}

/** Calls `onEvent` for each event of `app`, until the returned stop. */
function subscribeTo(client: CalimeroClient, app: string) {
  return (onEvent: () => void) => {
    const abort = new AbortController();
    void (async () => {
      try {
        for await (const _event of client.events(app, 0, abort.signal)) onEvent();
      } catch {
        // Stream closed (sign-out, group left, network): the poll timer still runs.
      }
    })();
    return () => abort.abort();
  };
}

export function App({
  deps = defaultDeps,
  storage = globalThis.localStorage,
}: {
  deps?: SessionDeps;
  storage?: KeyValueStorage;
}) {
  // Memoised: a new object every render would reconnect every render.
  const sessionDeps = useMemo(
    () => (storage === deps.storage || !storage ? deps : { ...deps, storage }),
    [deps, storage],
  );
  const api = useSession(sessionDeps, () => pendingInvite(storage));
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [opened, setOpened] = useState<OpenedGroup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const client = session.status === "signed-in" ? session.client : null;
  const key = session.status === "signed-in" ? selectionKey(session.target, session.accountId) : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The group opened last time, on this target, by this account.
  useEffect(() => {
    setOpened(key ? readSelection(storage, key) : null);
  }, [key, storage]);

  const open = useCallback(
    (group: OpenedGroup | null) => {
      setOpened(group);
      if (!key) return;
      try {
        if (group) storage.setItem(key, JSON.stringify({ appId: group.appId, name: group.name, org: group.org }));
        else storage.removeItem(key);
      } catch {
        /* remembered for this page only */
      }
    },
    [key, storage],
  );

  // An invitation link opened before signing in: a page of its own while it
  // is pending (see `Invitation.tsx`), redeemed only on "Join".
  const [invite, setInvite] = useState<string | null>(() => pendingInvite(storage));
  const [inviteLater, setInviteLater] = useState(false);
  useEffect(() => {
    if (client) setInvite(pendingInvite(storage));
  }, [client, storage]);

  const group: VoteGroup | null = useMemo(
    () =>
      client && opened
        ? { client: meroVote(client, opened.appId, after), subscribe: subscribeTo(client, opened.appId) }
        : null,
    [client, opened, after],
  );

  const onLogout = () => void signOut(api.signOut, key, storage).then(() => setOpened(null));
  const signedIn = session.status === "signed-in";
  const connecting = session.status === "connecting";

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">
              <VoteIcon size={17} />
            </span>
            <h1>Mero Vote</h1>
          </div>
          {signedIn && (
            <nav className="crumbs" aria-label="Breadcrumb">
              <span className="sep">
                <ChevronRightIcon size={14} />
              </span>
              <span className="crumb">
                <LayersIcon size={14} />
                Voting groups
              </span>
              {opened && (
                <>
                  <span className="sep">
                    <ChevronRightIcon size={14} />
                  </span>
                  <span className="crumb current" title={opened.appId}>
                    <BoxIcon size={14} />
                    {opened.name ? <span>{opened.name}</span> : <code className="mono">{shortId(opened.appId)}</code>}
                  </span>
                </>
              )}
            </nav>
          )}
          <div className="topbar-right">
            <span className="status-pill" title={signedIn ? "Connected" : connecting ? "Connecting" : "Not connected"}>
              <span className={`dot ${signedIn ? "live" : connecting ? "wait" : ""}`} />
              <span className="label">{signedIn ? "Connected" : connecting ? "Connecting" : "Not connected"}</span>
            </span>
            {signedIn && opened && (
              <button
                className="ghost sm collapse"
                onClick={() => open(null)}
                aria-label="Change group"
                title="Change group"
              >
                <SwitchIcon size={15} />
                <span className="btn-label">Change group</span>
              </button>
            )}
            <ThemeToggle />
            {session.status === "signed-in" && (
              <SessionMenu
                where={describeTarget(session.target)}
                accountId={session.accountId}
                appId={opened?.appId ?? null}
                onLogout={onLogout}
              />
            )}
            {signedIn && (
              // Always on screen, not only in the session menu: ending a session
              // should never take a hunt. The label folds to the icon on a phone;
              // the accessible name stays "Log out".
              <button
                type="button"
                className="ghost sm collapse logout"
                onClick={onLogout}
                aria-label="Log out"
                title="Log out"
                data-testid="logout-btn"
              >
                <LogOutIcon size={15} />
                <span className="btn-label">Log out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="wrap">
        {notice && (
          <Callout tone="success" icon={<CheckIcon size={18} />}>
            {notice}
          </Callout>
        )}
        {session.status === "connecting" ? (
          <div className="card center loading-card">
            <span className="spinner" aria-hidden="true" />
            <p className="empty">Connecting…</p>
          </div>
        ) : session.status === "listing" ? (
          <div className="card">
            <AppListing {...LISTING} />
          </div>
        ) : session.status === "unconfigured" ? (
          <div className="card">
            <h2>Not configured</h2>
            <pre className="err">{session.message}</pre>
          </div>
        ) : session.status === "signed-out" ? (
          invite && !inviteLater ? (
            <InvitationSignIn api={api} where={describeTarget(session.target)} onLater={() => setInviteLater(true)} />
          ) : (
            <Welcome api={api} where={describeTarget(session.target)} />
          )
        ) : invite ? (
          <JoinInvitation
            client={session.client}
            token={invite}
            storage={storage}
            after={after}
            onJoined={() => {
              setInvite(null);
              setNotice("Invitation accepted: the voting group is in your list.");
              setPickerKey((k) => k + 1);
              open(null);
            }}
            onClose={() => setInvite(null)}
          />
        ) : !opened || !group ? (
          <>
            <GroupPicker key={pickerKey} client={session.client} source={source} onOpen={open} after={after} />
            <div className="section-head join-head">
              <h3>
                <UserPlusIcon size={16} />
                Have an invitation?
              </h3>
            </div>
            <div className="card">
              <div className="card-head">
                <IconTile>
                  <LinkIcon size={18} />
                </IconTile>
                <div className="grow">
                  <h2>Join with an invitation</h2>
                  <div className="meta">
                    Open an invitation link someone sent you. It opens this app, and the group appears here once
                    you are signed in.
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <VoteGroupContext.Provider value={group}>
            {/* Keyed, so a group opened in place starts from nothing of the last one's. */}
            <VotePanel
              key={opened.appId}
              contextId={opened.appId}
              side={<InviteCard client={session.client} org={opened.org} passkey={deps.passkey} after={after} />}
            />
          </VoteGroupContext.Provider>
        )}
      </main>
    </>
  );
}

/** The front door: what the app is, and a passkey sign-in or sign-up. */
function Welcome({ api, where }: { api: SessionApi; where: string }) {
  return (
    <section className="welcome">
      <div className="welcome-copy">
        <span className="eyebrow pill">
          <ShieldCheckIcon size={14} />
          Secret ballot · public audit
        </span>
        <p className="welcome-title">
          Private polls with <span className="glass-grad-text">verifiable tallies</span>.
        </p>
        <p className="welcome-lead">
          Ballots are encrypted in your browser and proven well-formed in zero knowledge; no node ever sees a
          vote. Everyone can re-run the count.
        </p>
        <ul className="welcome-points">
          <li>
            <span className="icon-tile accent">
              <LockIcon size={18} />
            </span>
            <span>
              <strong>Encrypted here</strong>Your choice leaves this tab as ciphertext and a proof.
            </span>
          </li>
          <li>
            <span className="icon-tile">
              <KeyIcon size={18} />
            </span>
            <span>
              <strong>Shared key</strong>Trustees hold the decryption key together; no one holds all of it.
            </span>
          </li>
          <li>
            <span className="icon-tile">
              <BarChartIcon size={18} />
            </span>
            <span>
              <strong>Audited by everyone</strong>Every member can recompute the tally from the sealed
              ballots, in their own browser.
            </span>
          </li>
        </ul>
      </div>
      <div className="card connect-card">
        <span className="connect-mark">
          <ServerIcon size={22} />
        </span>
        <h2>Sign in</h2>
        <p>
          Sign in, or create an account, to see your voting groups. Connected to {where}. Accounts are passkeys: nothing to remember, nothing to leak.
        </p>
        <PasskeySignIn api={api} />
      </div>
    </section>
  );
}

/**
 * Where this session is connected, the account and the open group's app id,
 * plus a second Log out next to the session it ends (the top bar carries the
 * always-visible one).
 *
 * No inactivity logout anywhere in this app. A session ends when the user ends
 * it — being idle overnight is normal use.
 */
function SessionMenu({
  where,
  accountId,
  appId,
  onLogout,
}: {
  where: string;
  accountId: string;
  appId: string | null;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className="icon-btn round"
        title="Session"
        aria-label="Session"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ServerIcon size={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <span className="dot live" />
            Session
          </div>
          <dl className="kv">
            <dt>Cluster</dt>
            <dd>{where}</dd>
            <dt>Account</dt>
            <dd>
              <IdField value={accountId} label="account id" />
            </dd>
            <dt>Group</dt>
            <dd>{appId ? <IdField value={appId} label="app id" /> : <span className="empty">not selected</span>}</dd>
          </dl>
          <div className="menu-sep" />
          <button className="menu-item danger" role="menuitem" onClick={onLogout} data-testid="menu-logout-btn">
            <LogOutIcon size={16} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
