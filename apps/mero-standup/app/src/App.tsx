import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalimeroError, type AppInfo } from "@calimero-network/mero-js";
import { appSource, describeError, type KeyValueStorage } from "@calimero-apps/connect";
import { PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import { DecisionLog, type DecisionDraft } from "./DecisionLog";
import { InviteCard } from "./InviteCard";
import { PersonName } from "./names";
import { defaultDeps, describeTarget, useSession, type SessionApi, type SessionDeps } from "./session";
import { StandupBoard } from "./StandupBoard";
import { PACKAGE } from "./standup";
import { TeamPicker } from "./TeamPicker";
import { dropInvite, pendingInvite, selectionKey } from "./teams";
import { Avatar, Icon, useTheme, type Theme } from "./ui";
import { useRead, useTeam, type Team, type TeamTransport } from "./useTeam";
import { WeekDigest } from "./WeekDigest";

type Tab = "standup" | "week" | "decisions" | "invite";

/** The team open in this page: an app instance and the org it lives in. */
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

/**
 * Connects to the local nodes (dev) or the Cloud cluster (production), signs in
 * with a passkey, redeems an invitation opened before signing in, and opens the
 * team picked last time.
 */
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
  const api = useSession(sessionDeps);
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [theme, setTheme] = useTheme();

  const client = session.status === "signed-in" ? session.client : null;
  const key = session.status === "signed-in" ? selectionKey(session.target, session.accountId) : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The team opened last time, on this target, by this account.
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

  // An invitation link opened before signing in is redeemed once a session exists.
  useEffect(() => {
    if (!client) return;
    const token = pendingInvite(storage);
    if (!token) return;
    let live = true;
    client
      .redeemInvite(token)
      .then(() => {
        dropInvite(storage);
        if (live) {
          setNotice("Invitation accepted: the team is in your list.");
          setPickerKey((k) => k + 1);
          open(null);
        }
      })
      .catch((e: unknown) => {
        // A refusal (used, expired, revoked) can never succeed: drop it. Anything
        // else (the cluster unreachable) is kept and tried on the next load.
        if (e instanceof CalimeroError && e.status < 500) dropInvite(storage);
        if (live) setNotice(`The invitation could not be accepted: ${describeError(e)}`);
      })
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, storage, after, open]);

  if (session.status === "connecting") {
    return (
      <Shell>
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      </Shell>
    );
  }

  if (session.status === "unconfigured") {
    return (
      <Shell>
        <div className="card">
          <h2>Cannot connect</h2>
          <pre className="err">{session.message}</pre>
        </div>
      </Shell>
    );
  }

  if (session.status === "signed-out") {
    return (
      <Shell>
        <SignIn api={api} where={describeTarget(session.target)} />
      </Shell>
    );
  }

  const signOut = () => {
    setOpened(null);
    void api.signOut();
  };

  if (!opened) {
    return (
      <Shell right={<Menu theme={theme} setTheme={setTheme} onLogout={signOut} />}>
        {notice && (
          <div className="card">
            <p className="empty">{notice}</p>
          </div>
        )}
        <TeamPicker key={pickerKey} client={session.client} source={source} onOpen={open} after={after} />
        <div className="card">
          <h2>Join with an invitation</h2>
          <p className="empty">
            Open an invitation link someone sent you. You join their team&apos;s organization once you are
            signed in.
          </p>
        </div>
        <p className="empty footer-line">
          {describeTarget(session.target)} · account <code className="mono">{session.accountId}</code>
        </p>
      </Shell>
    );
  }

  return (
    // Keyed, so a team opened in place starts from nothing of the last one's.
    <TeamView
      key={opened.appId}
      transport={session.client}
      opened={opened}
      after={after}
      inviteClient={session.client}
      passkey={deps.passkey}
      theme={theme}
      setTheme={setTheme}
      onSwitchTeam={() => open(null)}
      onLogout={signOut}
    />
  );
}

/** Continue with a passkey, or create one. */
function SignIn({ api, where }: { api: SessionApi; where: string }) {
  return (
    <section className="hero card">
      <h1>Mero Standup</h1>
      <p className="lede">
        Async standups and a decision log for your team. Post what you did, what is next and what is in your
        way; record what you decided and why.
      </p>
      <ul className="hero-points">
        <li>Only your team&apos;s organization can read it.</li>
        <li>Yesterday&apos;s plan becomes today&apos;s draft, so posting takes seconds.</li>
        <li>Decisions are never edited, only superseded, so the why survives.</li>
      </ul>
      <p className="empty" style={{ marginBottom: 14 }}>
        Connected to {where}. Accounts are passkeys: nothing to remember, nothing to leak.
      </p>
      <div style={{ maxWidth: 360 }}>
        <PasskeySignIn api={api} />
      </div>
    </section>
  );
}

function Shell({ children, left, right }: { children: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <img src="./favicon.svg" alt="" width={26} height={26} />
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
  transport,
  opened,
  after,
  inviteClient,
  passkey,
  theme,
  setTheme,
  onSwitchTeam,
  onLogout,
}: {
  transport: TeamTransport;
  opened: Opened;
  after: () => void;
  inviteClient: Parameters<typeof InviteCard>[0]["client"];
  passkey: SessionDeps["passkey"];
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchTeam: () => void;
  onLogout: () => void;
}) {
  const team = useTeam(transport, opened.appId, after);
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
          onSwitchTeam={onSwitchTeam}
          onLogout={onLogout}
        />
      }
    >
      {me.error && <pre className="err">{me.error}</pre>}
      {me.data && myName.data === "" && <Welcome team={team} appId={opened.appId} />}

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
        <DecisionLog team={team} draft={decisionDraft} onDraftUsed={() => setDecisionDraft(null)} />
      )}
      {tab === "invite" && <InviteCard client={inviteClient} org={opened.org} passkey={passkey} after={after} />}
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
function Welcome({ team, appId }: { team: Team; appId: string }) {
  const key = `mero-standup:welcomed:${appId}`;
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
        team
          .act((c) => c.setName({ name }))
          .catch((err: unknown) => setError(describeError(err)))
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
