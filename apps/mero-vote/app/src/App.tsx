import { useEffect, useRef, useState } from "react";
import { ConnectButton, clearContextId, useMero } from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { InviteCard } from "./InviteCard";
import { JoinCard } from "./JoinCard";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import { VotePanel } from "./VotePanel";
import {
  BoxIcon,
  ChevronRightIcon,
  LayersIcon,
  LogOutIcon,
  ServerIcon,
  SwitchIcon,
  UserPlusIcon,
  VoteIcon,
} from "./icons";
import { IconTile, IdField, shortId } from "./ui";

export function App() {
  const { isAuthenticated, isLoading, applicationId, contextId, nodeUrl, logout } = useMero();
  // Mounted at the root, unconditionally: an invitation captured before login
  // has to be redeemed as soon as the session exists, which means this cannot
  // live inside a branch that only renders once a context is chosen.
  const {
    state: joinState,
    redeemPasted,
    confirmJoin,
    declineJoin,
  } = useJoinFromInvitation();

  // Drop the stored context and re-render at the picker. A reload rather than
  // local state, for the same reason `ContextPicker.select` reloads: the
  // provider reads the stored context on mount, so reloading is what makes the
  // provider and the UI agree instead of duplicating that logic here.
  function switchContext() {
    clearContextId();
    window.location.reload();
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">
              <VoteIcon size={16} />
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
                  <span className="crumb" title={contextId}>
                    <BoxIcon size={14} />
                    <code className="mono">{shortId(contextId)}</code>
                  </span>
                </>
              )}
            </nav>
          )}
          <div className="topbar-right">
            <span className="status-pill">
              <span className={`dot ${isAuthenticated ? "live" : isLoading ? "wait" : ""}`} />
              <span className="label">{isAuthenticated ? "Connected" : isLoading ? "Connecting" : "Not connected"}</span>
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
              <button className="ghost sm" onClick={switchContext}>
                <SwitchIcon size={14} />
                Change context
              </button>
            )}
            {isAuthenticated && (
              <SessionMenu
                nodeUrl={nodeUrl}
                applicationId={applicationId}
                contextId={contextId}
                onLogout={logout}
              />
            )}
          </div>
        </div>
      </header>

      <main className="wrap">
        {isLoading ? (
          <div className="card center">
            <p className="empty">Connecting…</p>
          </div>
        ) : !isAuthenticated ? (
          <div className="card center">
            <IconTile accent>
              <ServerIcon size={20} />
            </IconTile>
            <h2>Connect a node</h2>
            <p>
              Private polls with verifiable tallies. Ballots are encrypted in your
              browser and proven well-formed in zero knowledge; no node — yours
              included — ever sees a vote.
            </p>
            <p className="empty" style={{ marginBottom: 18 }}>
              The login modal discovers nodes on the usual local ports and accepts
              a URL directly.
            </p>
            <ConnectButton />
          </div>
        ) : !contextId ? (
          <>
            <ContextPicker applicationId={applicationId} />
            <div className="section-head">
              <h3>
                <UserPlusIcon size={16} />
                Have an invitation?
              </h3>
            </div>
            <JoinCard
              state={joinState}
              onSubmit={redeemPasted}
              onConfirm={confirmJoin}
              onDecline={declineJoin}
            />
          </>
        ) : (
          <>
            {/*
              A link can arrive while a context is already open, and the prompt has
              to be reachable then too — otherwise an invitation received mid-session
              waits silently until the user happens to log out.
            */}
            {joinState.status !== "idle" && (
              <div style={{ marginBottom: 16 }}>
                <JoinCard
                  state={joinState}
                  onSubmit={redeemPasted}
                  onConfirm={confirmJoin}
                  onDecline={declineJoin}
                />
              </div>
            )}
            <div className="ctx-layout">
              <div className="ctx-main">
                <VotePanel contextId={contextId} />
              </div>
              <aside className="ctx-side">
                <InviteCard contextId={contextId} />
              </aside>
            </div>
          </>
        )}
      </main>
    </>
  );
}

/**
 * Node, application and context ids, plus Log out — present but tucked away.
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
        className="icon-btn bordered"
        title="Session"
        aria-label="Session"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ServerIcon size={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">Session</div>
          <dl className="kv">
            <dt>Node</dt>
            <dd>
              <code className="mono" title={nodeUrl ?? ""}>{nodeUrl ?? "—"}</code>
            </dd>
            <dt>Application</dt>
            <dd>{applicationId ? <IdField value={applicationId} label="application id" /> : "—"}</dd>
            <dt>Context</dt>
            <dd>{contextId ? <IdField value={contextId} label="context id" /> : <span className="empty">not selected</span>}</dd>
          </dl>
          <div className="menu-sep" />
          <button className="menu-item" role="menuitem" onClick={onLogout}>
            <LogOutIcon size={16} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
