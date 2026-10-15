import { useEffect, useRef, useState } from "react";
import { ConnectButton, clearContextId, useMero } from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { DecisionLog, type DecisionDraft } from "./DecisionLog";
import { InviteCard } from "./InviteCard";
import { JoinCard } from "./JoinCard";
import { StandupBoard } from "./StandupBoard";
import { WeekDigest } from "./WeekDigest";
import { Avatar, Icon, useTheme, type Theme } from "./ui";
import { PersonName, TeamNamespace, useSpaceNames } from "./names";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import { useRead, useTeam, type Team } from "./useTeam";

type Tab = "standup" | "week" | "decisions" | "invite";

export function App() {
  const { isAuthenticated, isLoading, applicationId, contextId, logout } = useMero();
  // Mounted at the root, unconditionally: an invitation captured before login
  // has to be redeemed as soon as the session exists.
  const { state: joinState, redeemPasted, confirmJoin, declineJoin } = useJoinFromInvitation();
  const [theme, setTheme] = useTheme();

  const join = (
    <JoinCard
      state={joinState}
      onSubmit={redeemPasted}
      onConfirm={confirmJoin}
      onDecline={declineJoin}
    />
  );

  if (isLoading) {
    return (
      <Shell>
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      </Shell>
    );
  }

  if (!isAuthenticated) {
    return (
      <Shell>
        <section className="hero card">
          <h1>Mero Standup</h1>
          <p className="lede">
            Async standups and a decision log for your team. Post what you did, what is
            next and what is in your way; record what you decided and why.
          </p>
          <ul className="hero-points">
            <li>Lives on your team&apos;s own nodes — no server, nobody else can read it.</li>
            <li>Yesterday&apos;s plan becomes today&apos;s draft, so posting takes seconds.</li>
            <li>Decisions are never edited, only superseded, so the why survives.</li>
          </ul>
          <ConnectButton />
        </section>
      </Shell>
    );
  }

  if (!contextId) {
    return (
      <Shell right={<Menu theme={theme} setTheme={setTheme} onLogout={logout} />}>
        <ContextPicker applicationId={applicationId} />
        {join}
      </Shell>
    );
  }

  return (
    <TeamNamespace contextId={contextId}>
      <TeamView
        contextId={contextId}
        join={joinState.status !== "idle" ? join : null}
        theme={theme}
        setTheme={setTheme}
        onLogout={logout}
      />
    </TeamNamespace>
  );
}

function Shell({
  children,
  left,
  right,
}: {
  children: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <span className="brand-name">Standup</span>
          {left}
        </div>
        <div className="topbar-right">{right}</div>
      </header>
      {children}
    </div>
  );
}

function TeamView({
  contextId,
  join,
  theme,
  setTheme,
  onLogout,
}: {
  contextId: string;
  join: React.ReactNode;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onLogout: () => void;
}) {
  const team = useTeam(contextId);
  const [tab, setTab] = useState<Tab>("standup");
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft | null>(null);
  // Read once from the contract: it is the same string every view's `author`
  // carries, so "which update is mine" is a plain equality.
  const me = useRead(team.client, 0, (c) => c.whoami(), []);
  const myName = useRead(
    team.client,
    team.version,
    (c) => (me.data ? c.getName({ account: me.data }) : Promise.resolve("")),
    [me.data],
  );

  function switchTeam() {
    // The provider reads the stored context on mount, so a reload keeps the
    // two in agreement.
    clearContextId();
    window.location.reload();
  }

  return (
    <Shell
      left={<TeamName team={team} />}
      right={
        <Menu
          me={me.data}
          myName={myName.data ?? ""}
          team={team}
          theme={theme}
          setTheme={setTheme}
          onSwitchTeam={switchTeam}
          onLogout={onLogout}
        />
      }
    >
      {join}
      {me.error && <pre className="err">{me.error}</pre>}
      {me.data && myName.data === "" && <Welcome team={team} contextId={contextId} me={me.data} />}

      <nav className="tabs" role="tablist">
        {(
          [
            ["standup", "Standup"],
            ["week", "Week"],
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

      {tab === "standup" && (
        <StandupBoard
          team={team}
          me={me.data}
          onLogDecision={(draft) => {
            setDecisionDraft(draft);
            setTab("decisions");
          }}
        />
      )}
      {tab === "week" && <WeekDigest team={team} />}
      {tab === "decisions" && (
        <DecisionLog
          team={team}
          draft={decisionDraft}
          onDraftUsed={() => setDecisionDraft(null)}
        />
      )}
      {tab === "invite" && <InviteCard contextId={contextId} />}
    </Shell>
  );
}

/** The team's name in the top bar; click to rename. Any member may. */
function TeamName({ team }: { team: Team }) {
  const name = useRead(team.client, team.version, (c) => c.teamName(), []);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (draft !== null) {
    return (
      <form
        className="team-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          team
            .act((c) => c.setTeamName({ name: draft }))
            .then(() => setDraft(null))
            .finally(() => setBusy(false));
        }}
      >
        <input
          aria-label="team name"
          autoFocus
          maxLength={80}
          value={draft}
          placeholder="Name this team"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    );
  }
  return (
    <button
      className="team-name"
      data-testid="team-name"
      title="Rename this team"
      onClick={() => setDraft(name.data ?? "")}
    >
      <span className="slash">/</span>
      {name.data ? name.data : <span className="dim">Name this team</span>}
      <Icon name="pen" size={12} />
    </button>
  );
}

/**
 * First run in a team: ask for a name, because the alternative is everyone
 * seeing `4845d7…c6b1` on your updates. Skippable, and the skip is
 * remembered per team on this browser.
 */
function Welcome({ team, contextId, me }: { team: Team; contextId: string; me: string }) {
  const key = `mero-standup:welcomed:${contextId}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { nameOf, publish } = useSpaceNames();
  // Offer the name already set for the namespace, so joining is one click.
  const spaceName = nameOf(me);
  useEffect(() => {
    if (spaceName) setName((n) => n || spaceName);
  }, [spaceName]);
  if (dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Remembering the skip is a convenience.
    }
    setDismissed(true);
  }

  return (
    <form
      className="card welcome"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        publish(me, name);
        team
          .act((c) => c.setName({ name }))
          .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      }}
    >
      <h2>Welcome to the team</h2>
      <p className="empty">What should your teammates call you? It shows on everything you post.</p>
      <div className="row">
        <input
          aria-label="your name"
          autoFocus
          maxLength={64}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : "Continue"}
        </button>
        <button type="button" className="ghost" onClick={dismiss}>
          Later
        </button>
      </div>
      {error && <pre className="err">{error}</pre>}
    </form>
  );
}

/** Your avatar in the top bar, opening: your name, theme, switch team, log out. */
function Menu({
  me,
  myName,
  team,
  theme,
  setTheme,
  onSwitchTeam,
  onLogout,
}: {
  me?: string | null;
  myName?: string;
  team?: Team;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchTeam?: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { publish } = useSpaceNames();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className="menu-button"
        aria-label="account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {me ? <Avatar account={me} name={myName} size={30} /> : <Icon name="menu" />}
        {me && (
          <span className="menu-name" data-testid="my-name">
            <PersonName account={me} name={myName} />
          </span>
        )}
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          {me && team && (
            <div className="menu-section">
              {renaming === null ? (
                <button className="menu-item" onClick={() => setRenaming(myName ?? "")}>
                  <Icon name="pen" /> {myName ? "Change your name" : "Set your name"}
                </button>
              ) : (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    publish(me, renaming);
                    void team.act((c) => c.setName({ name: renaming })).then(() => setRenaming(null));
                  }}
                >
                  <input
                    aria-label="your name"
                    autoFocus
                    maxLength={64}
                    value={renaming}
                    onChange={(e) => setRenaming(e.target.value)}
                  />
                  <button type="submit">Save</button>
                </form>
              )}
            </div>
          )}
          <div className="menu-section">
            <span className="menu-label">Theme</span>
            <div className="segmented" role="radiogroup" aria-label="theme">
              {(["system", "light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={theme === t}
                  className={theme === t ? "active" : ""}
                  onClick={() => setTheme(t)}
                >
                  {t === "light" ? <Icon name="sun" size={14} /> : t === "dark" ? <Icon name="moon" size={14} /> : null}
                  {t[0]!.toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="menu-section">
            {onSwitchTeam && (
              <button className="menu-item" onClick={onSwitchTeam}>
                Switch team
              </button>
            )}
            <button className="menu-item danger-text" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
