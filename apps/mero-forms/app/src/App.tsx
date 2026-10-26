import { useEffect, useRef, useState } from "react";
import {
  InvitationDialog,
  InvitationGate,
  clearContextId,
  useContextGroup,
  useMero,
} from "@calimero-network/mero-react";
import { ContextPicker } from "./ContextPicker";
import LandingPage from "./pages/landing/LandingPage";
import { FormView as FormPage } from "./FormView";
import { FormsHome } from "./FormsHome";
import { PublicForm } from "./PublicForm";
import { PUBLIC_PATH } from "./lib/publicLink";
import { TeamCard } from "./TeamCard";
import { Avatar, Icon, useTheme, type Theme } from "./ui";
import { PersonName, TeamNamespace, useSpaceNames } from "./names";
import { readInvitation, useJoinFromInvitation } from "./useJoinFromInvitation";
import { BASE, appPath, useRoute, type Route } from "./route";
import { useWorkspace, useRead, type Workspace } from "./useWorkspace";

/** A workspace opened in this page, ahead of the one the provider read from storage. */
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
  // has to be redeemed as soon as the session exists. Joining opens the
  // workspace in place.
  const invitation = useJoinFromInvitation({
    onOpen: (contextId, namespaceId) => setOpened({ contextId, namespaceId }),
  });
  const [theme, setTheme] = useTheme();

  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={readInvitation} noun="workspace" appName="Mero Forms" />
      <InvitationDialog
        redemption={invitation}
        noun="workspace"
        appName="Mero Forms"
        // The grant is the namespace, and the person accepting should know that
        // before they click; reading responses also needs an admin's "add to team".
        detail="Joining makes this node a member of the namespace this workspace lives in. An admin then adds you to the team to give you its forms and responses."
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

/** The paths the shared landing page serves besides `/`. See src/pages/landing. */
const LANDING_PATHS = ["/docs", "/preview"];
const isLandingPath = (path: string) => LANDING_PATHS.includes(path.replace(/\/+$/, ""));

/**
 * Re-render on back and forward, so leaving `/docs` for the app (or the other
 * way) swaps the page. The landing page pushes its own paths.
 */
function usePathname() {
  const [path, setPath] = useState(() => appPath(window.location.pathname));
  useEffect(() => {
    const on = () => setPath(appPath(window.location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
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
  const path = usePathname();
  // A form opened from its public link: whoever opened it, signed in or not,
  // sees only the form, answered with the key the link carries.
  if (path.replace(/\/+$/, "") === PUBLIC_PATH) return <PublicForm />;
  if (isLoading) {
    return (
      <Shell>
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      </Shell>
    );
  }

  // The shared landing page: the front door when signed out, and its `/docs`
  // and `/preview` pages for anyone, since a signed-in teammate is exactly who
  // is likely to read them. It manages those three paths itself; the app's own
  // routes live in the hash, so the two never meet.
  if (!isAuthenticated || isLandingPath(path)) {
    return (
      <LandingPage
        isAuthenticated={isAuthenticated}
        onOpenApp={() => {
          window.history.pushState(null, "", BASE);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }}
      />
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
    // Keyed, so a workspace opened in place starts from nothing of the last one's.
    <TeamNamespace key={contextId} contextId={contextId}>
      <WorkspaceView
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
          <img src="./favicon.svg" alt="" width={26} height={26} />
          <span className="brand-name">Forms</span>
          {left}
        </div>
        <div className="topbar-right">{right}</div>
      </header>
      {children}
    </div>
  );
}

function WorkspaceView({
  contextId,
  joinedNamespace,
  theme,
  setTheme,
  onLogout,
}: {
  contextId: string;
  /** The namespace, when the workspace was just joined in this page. */
  joinedNamespace: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onLogout: () => void;
}) {
  const workspace = useWorkspace(contextId);
  // This app's contexts live directly in the namespace (see ContextPicker), so
  // the context's group is the namespace an invitation joined.
  const { groupId } = useContextGroup(joinedNamespace ? null : contextId);
  const namespaceId = joinedNamespace ?? groupId;
  const [route, go] = useRoute();
  const me = useRead(workspace.client, 0, (c) => c.myAccount(), []);
  const onTeam = useRead(workspace.client, workspace.version, (c) => c.amITeam(), []);
  const isAdmin = useRead(workspace.client, workspace.version, (c) => c.amIAdmin(), []);

  function switchWorkspace() {
    // The provider reads the stored context on mount, so a reload keeps the
    // two in agreement.
    clearContextId();
    window.location.hash = "";
    window.location.reload();
  }

  const shell = (children: React.ReactNode) => (
    <Shell
      left={<WorkspaceName workspace={workspace} editable={onTeam.data === true} />}
      right={
        <Menu
          me={me.data}
          theme={theme}
          setTheme={setTheme}
          onSwitchWorkspace={switchWorkspace}
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
          You are in this workspace&apos;s namespace, but only the team builds forms and reads
          responses. Ask an admin to open <strong>Team</strong> and add you; you are listed there
          as a member. Your account:
        </p>
        <code className="mono invite-link">{me.data}</code>
      </div>,
    );
  }

  const top: [Route["page"], string][] = [
    ["forms", "Forms"],
    ["team", "Team"],
  ];

  return shell(
    <>
      {route.page !== "form" && (
        <nav className="tabs" role="tablist">
          {top.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={route.page === id}
              className={route.page === id ? "tab active" : "tab"}
              onClick={() => go({ page: id } as Route)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {route.page === "forms" && (
        <FormsHome workspace={workspace} onOpen={(id, tab) => go({ page: "form", id, tab: tab ?? "responses" })} />
      )}
      {route.page === "form" && (
        <FormPage
          key={route.id}
          formId={route.id}
          tab={route.tab}
          onTab={(tab) => go({ page: "form", id: route.id, tab })}
          onBack={() => go({ page: "forms" })}
          workspace={workspace}
          contextId={contextId}
          namespaceId={namespaceId}
          isAdmin={isAdmin.data === true}
        />
      )}
      {route.page === "team" && (
        <TeamCard
          workspace={workspace}
          contextId={contextId}
          namespaceId={namespaceId}
          isAdmin={isAdmin.data === true}
          me={me.data}
        />
      )}
    </>,
  );
}

/** The workspace's name in the top bar; the team clicks it to rename. */
function WorkspaceName({ workspace, editable }: { workspace: Workspace; editable: boolean }) {
  const name = useRead(workspace.client, workspace.version, (c) => c.workspaceName(), []);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (draft !== null) {
    return (
      <form
        className="team-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          workspace
            .act((c) => c.setWorkspaceName({ name: draft }))
            .then(() => setDraft(null))
            .finally(() => setBusy(false));
        }}
      >
        <input
          aria-label="workspace name"
          autoFocus
          maxLength={80}
          value={draft}
          placeholder="Name this workspace"
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
      data-testid="workspace-name"
      title="Rename this workspace"
      onClick={() => setDraft(name.data ?? "")}
    >
      <span className="slash">/</span>
      {name.data ? name.data : <span className="dim">Name this workspace</span>}
      <Icon name="pen" size={12} />
    </button>
  );
}

/** Your avatar in the top bar, opening: your name, theme, switch workspace, log out. */
function Menu({
  me,
  theme,
  setTheme,
  onSwitchWorkspace,
  onLogout,
}: {
  me?: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchWorkspace?: () => void;
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
            {onSwitchWorkspace && (
              <button className="menu-item" onClick={onSwitchWorkspace}>
                Switch workspace
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
