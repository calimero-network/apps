import { useCallback, useEffect, useRef, useState } from "react";
import LandingPage from "./pages/landing/LandingPage";
import { FormView as FormPage } from "./FormView";
import { FormsHome } from "./FormsHome";
import { PublicForm } from "./PublicForm";
import { PUBLIC_PATH } from "./lib/publicLink";
import { CaptchaCard } from "./CaptchaCard";
import { TeamCard } from "./TeamCard";
import { InvitationHost, SignInModal } from "./SignIn";
import { WorkspacePicker } from "./WorkspacePicker";
import { Avatar, Icon, useTheme, type Theme } from "./ui";
import { PersonName, TeamNamespace, useSpaceNames } from "./names";
import { BASE, appPath, useRoute, type Route } from "./route";
import { useActiveWorkspace } from "./useActiveWorkspace";
import { useWorkspace, useRead, type Workspace } from "./useWorkspace";
import type { SessionDeps } from "./session";
import { SessionProvider, useMaybeSignedIn, useSessionApi } from "./sessionContext";

export function App({ deps }: { deps?: SessionDeps } = {}) {
  return (
    <SessionProvider deps={deps}>
      <Root />
    </SessionProvider>
  );
}

function Root() {
  const [theme, setTheme] = useTheme();
  // Bumped when an invitation is redeemed, so the remembered workspace (the
  // one the link named) is read again.
  const [joined, setJoined] = useState(0);
  const onJoined = useCallback(() => setJoined((n) => n + 1), []);
  return (
    // Around the app: an invitation link can land on any page, and while one
    // is pending its screens stand in for it.
    <InvitationHost onJoined={onJoined}>
      <Screen key={joined} theme={theme} setTheme={setTheme} />
    </InvitationHost>
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

/** Whichever state the session is in. */
function Screen({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const path = usePathname();
  const [signingIn, setSigningIn] = useState(false);
  // A form opened from its public link: whoever opened it, signed in or not,
  // sees only the form, answered with the key the link carries.
  if (path.replace(/\/+$/, "") === PUBLIC_PATH) return <PublicForm />;
  if (api.session.status === "connecting") {
    return (
      <Shell>
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      </Shell>
    );
  }

  // The shared landing page: the front door when signed out, and its `/docs`
  // and `/preview` pages for anyone. It manages those three paths itself; the
  // app's own routes live in the hash, so the two never meet.
  if (!signedIn || isLandingPath(path)) {
    return (
      <>
        <LandingPage
          isAuthenticated={!!signedIn}
          onConnect={() => setSigningIn(true)}
          onOpenApp={() => {
            window.history.pushState(null, "", BASE);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
        />
        <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
      </>
    );
  }

  return (
    <SignedInApp key={signedIn.accountId} theme={theme} setTheme={setTheme} onLogout={() => void signedIn.signOut()} />
  );
}

/** Signed in: the workspace picker, or the open workspace. */
function SignedInApp({
  theme,
  setTheme,
  onLogout,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  onLogout: () => void;
}) {
  const { active, open, leaving } = useActiveWorkspace();
  // Moving to the frontend of the release the open workspace runs.
  if (leaving) return null;

  if (!active) {
    return (
      <Shell right={<Menu theme={theme} setTheme={setTheme} onLogout={onLogout} />}>
        <WorkspacePicker onOpen={open} />
        <div className="card">
          <h2>Join with an invitation</h2>
          <p className="empty">
            Open an invitation link someone sent you. It opens this app and asks before joining.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    // Keyed, so a workspace opened in place starts from nothing of the last one's.
    <TeamNamespace key={active.appId} org={active.org}>
      <WorkspaceView
        appId={active.appId}
        org={active.org}
        theme={theme}
        setTheme={setTheme}
        onSwitchWorkspace={() => {
          window.location.hash = "";
          open(null);
        }}
        onLogout={onLogout}
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
  appId,
  org,
  theme,
  setTheme,
  onSwitchWorkspace,
  onLogout,
}: {
  appId: string;
  /** The organization the workspace lives in. */
  org: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchWorkspace: () => void;
  onLogout: () => void;
}) {
  const workspace = useWorkspace(appId);
  const [route, go] = useRoute();
  const me = useRead(workspace.client, 0, (c) => c.myAccount(), []);
  const onTeam = useRead(workspace.client, workspace.version, (c) => c.amITeam(), []);
  const isAdmin = useRead(workspace.client, workspace.version, (c) => c.amIAdmin(), []);
  const switchWorkspace = onSwitchWorkspace;

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
          You are in this workspace&apos;s organization, but only the team builds forms and reads
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
          appId={appId}
          isAdmin={isAdmin.data === true}
        />
      )}
      {route.page === "team" && (
        <>
          <TeamCard
            workspace={workspace}
            appId={appId}
            org={org}
            isAdmin={isAdmin.data === true}
            me={me.data}
          />
          <CaptchaCard workspace={workspace} isAdmin={isAdmin.data === true} />
        </>
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
                    // Your name is the organization's, shared by every app in it.
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
