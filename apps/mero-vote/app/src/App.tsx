import { useEffect, useRef, useState } from "react";
import {
  ConnectButton,
  InvitationDialog,
  clearContextId,
  useMero,
} from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { InviteCard } from "./InviteCard";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import { VotePanel } from "./VotePanel";
import { ThemeToggle } from "./ThemeToggle";
import { signOut } from "./signOut";
import {
  BarChartIcon,
  BoxIcon,
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
import { IconTile, IdField, shortId } from "./ui";

export function App() {
  const {
    isAuthenticated,
    isLoading,
    applicationId,
    contextId: stored,
    nodeUrl,
    logout,
  } = useMero();
  // A context joined in this page, ahead of the one the provider read from
  // storage: opening it in place keeps the invitation dialog up until its
  // polls have been read.
  const [opened, setOpened] = useState<{
    contextId: string;
    namespaceId: string;
  } | null>(null);
  const contextId = opened?.contextId ?? stored;
  // Mounted at the root, unconditionally: an invitation captured before login
  // has to be redeemed as soon as the session exists, which means this cannot
  // live inside a branch that only renders once a context is chosen.
  const join = useJoinFromInvitation({
    onOpen: (contextId, namespaceId) => setOpened({ contextId, namespaceId }),
  });

  // Drop the stored context and re-render at the picker. A reload rather than
  // local state, for the same reason `ContextPicker.select` reloads: the
  // provider reads the stored context on mount, so reloading is what makes the
  // provider and the UI agree instead of duplicating that logic here.
  function switchContext() {
    clearContextId();
    window.location.reload();
  }

  const onLogout = () => signOut(logout);

  return (
    <>
      {/*
        At the root, so a link that arrives while a context is already open is
        answered too, not left waiting until the user happens to log out.
      */}
      <InvitationDialog
        redemption={join}
        noun="voting group"
        appName="Mero Vote"
        // The grant is the namespace, not just the context the link names, and
        // the person accepting should know that before they click.
        detail="Joining makes this node a member of the namespace this voting group lives in, and its polls and ballots sync here from the other members."
      />
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">
              <VoteIcon size={17} />
            </span>
            <h1>Mero Vote</h1>
          </div>
          {isAuthenticated && (
            <nav className="crumbs" aria-label="Breadcrumb">
              <span className="sep">
                <ChevronRightIcon size={14} />
              </span>
              <span className="crumb">
                <LayersIcon size={14} />
                Contexts
              </span>
              {contextId && (
                <>
                  <span className="sep">
                    <ChevronRightIcon size={14} />
                  </span>
                  <span className="crumb current" title={contextId}>
                    <BoxIcon size={14} />
                    <code className="mono">{shortId(contextId)}</code>
                  </span>
                </>
              )}
            </nav>
          )}
          <div className="topbar-right">
            <span
              className="status-pill"
              title={
                isAuthenticated
                  ? "Connected"
                  : isLoading
                    ? "Connecting"
                    : "Not connected"
              }
            >
              <span
                className={`dot ${isAuthenticated ? "live" : isLoading ? "wait" : ""}`}
              />
              <span className="label">
                {isAuthenticated
                  ? "Connected"
                  : isLoading
                    ? "Connecting"
                    : "Not connected"}
              </span>
            </span>
            {isAuthenticated && contextId && (
              /*
                The only way back. Selecting a context used to be a ONE-WAY door:
                `setContextId` is written to storage and the app then renders the
                panel forever, so the picker was unreachable without clearing
                site data or logging out. A node routinely holds several
                contexts, and comparing two of them is the normal way to watch
                a CRDT converge.
              */
              <button
                className="ghost sm collapse"
                onClick={switchContext}
                aria-label="Change context"
                title="Change context"
              >
                <SwitchIcon size={15} />
                <span className="btn-label">Change context</span>
              </button>
            )}
            <ThemeToggle />
            {isAuthenticated && (
              <SessionMenu
                nodeUrl={nodeUrl}
                applicationId={applicationId}
                contextId={contextId}
                onLogout={onLogout}
              />
            )}
            {isAuthenticated && (
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
        {isLoading ? (
          <div className="card center loading-card">
            <span className="spinner" aria-hidden="true" />
            <p className="empty">Connecting…</p>
          </div>
        ) : !isAuthenticated ? (
          <section className="welcome">
            <div className="welcome-copy">
              <span className="eyebrow pill">
                <ShieldCheckIcon size={14} />
                Secret ballot · public audit
              </span>
              <p className="welcome-title">
                Private polls with{" "}
                <span className="glass-grad-text">verifiable tallies</span>.
              </p>
              <p className="welcome-lead">
                Ballots are encrypted in your browser and proven well-formed in
                zero knowledge; no node — yours included — ever sees a vote.
                Everyone can re-run the count.
              </p>
              <ul className="welcome-points">
                <li>
                  <span className="icon-tile accent">
                    <LockIcon size={18} />
                  </span>
                  <span>
                    <strong>Encrypted here</strong>Your choice leaves this tab
                    as ciphertext and a proof.
                  </span>
                </li>
                <li>
                  <span className="icon-tile">
                    <KeyIcon size={18} />
                  </span>
                  <span>
                    <strong>Shared key</strong>Trustees hold the decryption key
                    together; no one holds all of it.
                  </span>
                </li>
                <li>
                  <span className="icon-tile">
                    <BarChartIcon size={18} />
                  </span>
                  <span>
                    <strong>Audited by everyone</strong>Every member&apos;s node
                    recomputes the tally from the frozen ballots.
                  </span>
                </li>
              </ul>
            </div>
            <div className="card connect-card">
              <span className="connect-mark">
                <ServerIcon size={22} />
              </span>
              <h2>Connect a node</h2>
              <p>
                Sign in to your Calimero node to see your voting groups. The
                login modal discovers nodes on the usual local ports and accepts
                a URL directly.
              </p>
              <ConnectButton />
            </div>
          </section>
        ) : !contextId ? (
          <>
            <ContextPicker applicationId={applicationId} />
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
                    Open an invitation link someone sent you. It opens this app
                    and asks before joining.
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Keyed, so a context opened in place starts from nothing of the last one's. */}
            <VotePanel
              key={contextId}
              contextId={contextId}
              joinedNamespace={
                opened?.contextId === contextId ? opened.namespaceId : null
              }
              side={<InviteCard contextId={contextId} />}
            />
          </>
        )}
      </main>
    </>
  );
}

/**
 * Node, application and context ids, plus a second Log out next to the
 * session it ends (the top bar carries the always-visible one).
 *
 * No inactivity logout anywhere in this app. A session ends when the user ends
 * it — being idle overnight is normal use, and it costs nothing in exposure
 * since the refresh token already lives in the same localStorage as the access
 * token.
 */
function SessionMenu({
  nodeUrl,
  applicationId,
  contextId,
  onLogout,
}: {
  nodeUrl: string | null | undefined;
  applicationId: string | null | undefined;
  contextId: string | null | undefined;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
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
            <dt>Node</dt>
            <dd>
              <code className="mono" title={nodeUrl ?? ""}>
                {nodeUrl ?? "—"}
              </code>
            </dd>
            <dt>Application</dt>
            <dd>
              {applicationId ? (
                <IdField value={applicationId} label="application id" />
              ) : (
                "—"
              )}
            </dd>
            <dt>Context</dt>
            <dd>
              {contextId ? (
                <IdField value={contextId} label="context id" />
              ) : (
                <span className="empty">not selected</span>
              )}
            </dd>
          </dl>
          <div className="menu-sep" />
          <button
            className="menu-item danger"
            role="menuitem"
            onClick={onLogout}
            data-testid="menu-logout-btn"
          >
            <LogOutIcon size={16} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
