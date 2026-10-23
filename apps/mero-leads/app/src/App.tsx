import { useEffect, useRef, useState } from "react";
import {
  ConnectButton,
  InvitationDialog,
  InvitationGate,
  clearContextId,
  useContextGroup,
  useMero,
} from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import { FormKeys } from "./FormKeys";
import { LeadsBoard } from "./LeadsBoard";
import { TeamCard } from "./TeamCard";
import { Avatar, Icon, useTheme, type Theme } from "./ui";
import { PersonName, TeamNamespace, useSpaceNames } from "./names";
import { readInvitation, useJoinFromInvitation } from "./useJoinFromInvitation";
import { useInbox, useRead, type Inbox } from "./useInbox";

type Tab = "leads" | "team" | "forms";

/** An inbox opened in this page, ahead of the one the provider read from storage. */
interface OpenedTeam {
  contextId: string;
  namespaceId: string;
}

export function App() {
  const { isAuthenticated, isLoading, applicationId, contextId: stored, logout } =
    useMero();
  const [opened, setOpened] = useState<OpenedTeam | null>(null);
  const contextId = opened?.contextId ?? stored;
  // Mounted at the root, unconditionally: an invitation captured before login
  // has to be redeemed as soon as the session exists. Joining opens the inbox
  // in place.
  const invitation = useJoinFromInvitation({
    onOpen: (contextId, namespaceId) => setOpened({ contextId, namespaceId }),
  });
  const [theme, setTheme] = useTheme();

  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={readInvitation} noun="inbox" appName="Mero Leads" />
      <InvitationDialog
        redemption={invitation}
        noun="inbox"
        appName="Mero Leads"
        // The grant is the namespace, and the person accepting should know that
        // before they click; reading leads also needs an admin's "add to team".
        detail="Joining makes this node a member of the namespace this inbox lives in. An admin then adds you to the team to give you the leads."
      />
      <Screen
        isLoading={isLoading}
        isAuthenticated={isAuthenticated}
        applicationId={applicationId}
        contextId={contextId}
        joinedNamespace={
          opened && opened.contextId === contextId ? opened.namespaceId : null
        }
        theme={theme}
        setTheme={setTheme}
        logout={logout}
      />
    </>
  );
}

/** Whichever of the four states the session is in. */
function Screen({
  isLoading,
  isAuthenticated,
  applicationId,
  contextId,
  joinedNamespace,
  theme,
  setTheme,
  logout,
}: {
  isLoading: boolean;
  isAuthenticated: boolean;
  applicationId: string | null;
  contextId: string | null;
  joinedNamespace: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  logout: () => void;
}) {
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
          <h1>Mero Leads</h1>
          <p className="lede">
            An inbox for the leads your website&apos;s contact form collects, and a pipeline
            your team moves them through.
          </p>
          <ul className="hero-points">
            <li>Leads live on your team&apos;s own nodes — no SaaS in the middle, nobody else can read them.</li>
            <li>Your website gets a key that can add leads and nothing else, issued from this app.</li>
            <li>What a visitor sent is kept exactly as sent; the team&apos;s edits sit beside it.</li>
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
        <div className="card">
          <h2>Join with an invitation</h2>
          <p className="empty">
            Open an invitation link someone sent you. It opens this app and asks
            before joining.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    // Keyed, so an inbox opened in place starts from nothing of the last one's.
    <TeamNamespace key={contextId} contextId={contextId}>
      <InboxView
        contextId={contextId}
        joinedNamespace={joinedNamespace}
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
          <span className="brand-name">Leads</span>
          {left}
        </div>
        <div className="topbar-right">{right}</div>
      </header>
      {children}
    </div>
  );
}

function InboxView({
  contextId,
  joinedNamespace,
  theme,
  setTheme,
  onLogout,
}: {
  contextId: string;
  /** The namespace, when the inbox was just joined in this page. */
  joinedNamespace: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onLogout: () => void;
}) {
  const inbox = useInbox(contextId);
  // This app's contexts live directly in the namespace (see ContextPicker), so
  // the context's group is the namespace an invitation joined.
  const { groupId } = useContextGroup(joinedNamespace ? null : contextId);
  const namespaceId = joinedNamespace ?? groupId;
  const [tab, setTab] = useState<Tab>("leads");
  const me = useRead(inbox.client, 0, (c) => c.myAccount(), []);
  const onTeam = useRead(inbox.client, inbox.version, (c) => c.amITeam(), []);
  const isAdmin = useRead(inbox.client, inbox.version, (c) => c.amIAdmin(), []);

  function switchInbox() {
    // The provider reads the stored context on mount, so a reload keeps the
    // two in agreement.
    clearContextId();
    window.location.reload();
  }

  const shell = (children: React.ReactNode) => (
    <Shell
      left={<InboxName inbox={inbox} editable={onTeam.data === true} />}
      right={
        <Menu
          me={me.data}
          theme={theme}
          setTheme={setTheme}
          onSwitchInbox={switchInbox}
          onLogout={onLogout}
        />
      }
    >
      {children}
    </Shell>
  );

  if (me.error) return shell(<pre className="err">{me.error}</pre>);
  if (onTeam.data === null) return shell(<div className="card"><p className="empty">Loading…</p></div>);

  if (!onTeam.data) {
    return shell(
      <div className="card" data-testid="not-on-team">
        <h2>Waiting to be added to the team</h2>
        <p className="empty">
          You are in this inbox&apos;s namespace, but only the team reads leads. Ask an admin to
          open <strong>Team</strong> and add you; you are listed there as a member. Your account:
        </p>
        <code className="mono invite-link">{me.data}</code>
      </div>,
    );
  }

  const tabs: [Tab, string][] = [
    ["leads", "Leads"],
    ["team", "Team"],
    ...(isAdmin.data ? ([["forms", "Forms"]] as [Tab, string][]) : []),
  ];

  return shell(
    <>
      <nav className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
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

      {tab === "leads" && <LeadsBoard inbox={inbox} me={me.data} />}
      {tab === "team" && (
        <TeamCard
          inbox={inbox}
          contextId={contextId}
          namespaceId={namespaceId}
          isAdmin={isAdmin.data === true}
          me={me.data}
        />
      )}
      {tab === "forms" && isAdmin.data && (
        <FormKeys inbox={inbox} contextId={contextId} namespaceId={namespaceId} />
      )}
    </>,
  );
}

/** The inbox's name in the top bar; the team clicks it to rename. */
function InboxName({ inbox, editable }: { inbox: Inbox; editable: boolean }) {
  const name = useRead(inbox.client, inbox.version, (c) => c.inboxName(), []);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (draft !== null) {
    return (
      <form
        className="team-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          inbox
            .act((c) => c.setInboxName({ name: draft }))
            .then(() => setDraft(null))
            .finally(() => setBusy(false));
        }}
      >
        <input
          aria-label="inbox name"
          autoFocus
          maxLength={80}
          value={draft}
          placeholder="Name this inbox"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    );
  }
  if (!editable) {
    return name.data ? (
      <span className="team-name">
        <span className="slash">/</span>
        {name.data}
      </span>
    ) : null;
  }
  return (
    <button
      className="team-name"
      data-testid="inbox-name"
      title="Rename this inbox"
      onClick={() => setDraft(name.data ?? "")}
    >
      <span className="slash">/</span>
      {name.data ? name.data : <span className="dim">Name this inbox</span>}
      <Icon name="pen" size={12} />
    </button>
  );
}

/** Your avatar in the top bar, opening: your name, theme, switch inbox, log out. */
function Menu({
  me,
  theme,
  setTheme,
  onSwitchInbox,
  onLogout,
}: {
  me?: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchInbox?: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { nameOf, publish } = useSpaceNames();

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
        {me ? <Avatar account={me} size={30} /> : <Icon name="menu" />}
        {me && (
          <span className="menu-name" data-testid="my-name">
            <PersonName account={me} />
          </span>
        )}
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          {me && (
            <div className="menu-section">
              {renaming === null ? (
                <button className="menu-item" onClick={() => setRenaming(nameOf(me) ?? "")}>
                  <Icon name="pen" /> {nameOf(me) ? "Change your name" : "Set your name"}
                </button>
              ) : (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    // Your name is the namespace's, shared by every app on it.
                    publish(me, renaming);
                    setRenaming(null);
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
            {onSwitchInbox && (
              <button className="menu-item" onClick={onSwitchInbox}>
                Switch inbox
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
