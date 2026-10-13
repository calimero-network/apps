import { useState } from "react";
import { ConnectButton, clearContextId, useMero } from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { DecisionLog } from "./DecisionLog";
import { InviteCard } from "./InviteCard";
import { JoinCard } from "./JoinCard";
import { NameBar } from "./NameBar";
import { StandupBoard } from "./StandupBoard";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import { useRead, useTeam } from "./useTeam";

type Tab = "standup" | "decisions" | "invite";

export function App() {
  const { isAuthenticated, isLoading, applicationId, contextId, logout } = useMero();
  // Mounted at the root, unconditionally: an invitation captured before login
  // has to be redeemed as soon as the session exists.
  const { state: joinState, redeemPasted, confirmJoin, declineJoin } = useJoinFromInvitation();

  return (
    <div className="wrap">
      <header className="app-header">
        <div>
          <h1>Mero Standup</h1>
          <p className="sub">
            Async standups and a decision log for your team — synced between your own nodes,
            readable by nobody else.
          </p>
        </div>
        {isAuthenticated && (
          <button className="ghost" onClick={logout}>
            Log out
          </button>
        )}
      </header>

      {isLoading ? (
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      ) : !isAuthenticated ? (
        <div className="card">
          <h2>Connect a node</h2>
          <p className="empty" style={{ marginBottom: 14 }}>
            Your team&apos;s updates live on your own node. Connect to it to start.
          </p>
          <ConnectButton />
        </div>
      ) : !contextId ? (
        <>
          <ContextPicker applicationId={applicationId} />
          <JoinCard
            state={joinState}
            onSubmit={redeemPasted}
            onConfirm={confirmJoin}
            onDecline={declineJoin}
          />
        </>
      ) : (
        <>
          {/* A link can arrive while a team is open; the prompt must be reachable then too. */}
          {joinState.status !== "idle" && (
            <JoinCard
              state={joinState}
              onSubmit={redeemPasted}
              onConfirm={confirmJoin}
              onDecline={declineJoin}
            />
          )}
          <TeamView contextId={contextId} />
        </>
      )}
    </div>
  );
}

function TeamView({ contextId }: { contextId: string }) {
  const team = useTeam(contextId);
  const [tab, setTab] = useState<Tab>("standup");
  // The account this session posts as. Read once from the contract rather
  // than derived client-side: it is the same string every view's `author`
  // carries, so "which update is mine" is a plain equality.
  const me = useRead(team.client, 0, (c) => c.whoami(), []);

  // Drop the stored context and reload at the picker: the provider reads the
  // stored context on mount, so a reload keeps the two in agreement.
  function switchTeam() {
    clearContextId();
    window.location.reload();
  }

  return (
    <>
      <div className="card context-bar">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <NameBar team={team} me={me.data} />
          <button className="ghost" onClick={switchTeam}>
            Switch team
          </button>
        </div>
        {me.error && <pre className="err">{me.error}</pre>}
      </div>

      <nav className="tabs" role="tablist">
        {(
          [
            ["standup", "Standup"],
            ["decisions", "Decisions"],
            ["invite", "Invite"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "tab active" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "standup" && <StandupBoard team={team} me={me.data} />}
      {tab === "decisions" && <DecisionLog team={team} />}
      {tab === "invite" && <InviteCard contextId={contextId} />}
    </>
  );
}
