import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ManageInHomeLink, NativeApproval } from "@calimero-apps/passkey";
import { finishNativeSignIn, pendingNativeApproval, pendingNativeSignIn } from "@calimero-apps/passkey/native";

import { AppFooter } from "./AppFooter";
import { Tutorial, tutorialSeen } from "./Tutorial";
import { InfoPage } from "./InfoPages";
import { InstallPage } from "./InstallPage";
import { Landing, LandingPage } from "./Landing";
import { MeetingPage } from "./MeetingPage";
import { MeetingsList } from "./MeetingsList";
import { UploadRecording } from "./UploadRecording";
import { forgetWorkspaceRecordings, pruneRecordings } from "./useRecording";
import { OpenActions } from "./OpenActions";
import { PeoplePage } from "./PeoplePage";
import { ProfilePage } from "./ProfilePage";
import { InvitationHost, SignInModal, SignInPanel } from "./SignIn";
import { WorkspacePicker } from "./WorkspacePicker";
import { listWorkspaces } from "./lib/orgs";
import { NATIVE_APPROVE_CALLBACK, NATIVE_CALLBACK, signInIntent } from "./native";
import { PersonName, TeamNamespace, useSpaceNames } from "./names";
import { linkedWorkspace, useRoute } from "./route";
import { PRODUCT, type SessionDeps } from "./session";
import { SessionProvider, useMaybeSignedIn, useSessionApi, useSignedIn } from "./sessionContext";
import { Icon, useTheme, type Theme } from "./ui";
import { useActiveWorkspace } from "./useActiveWorkspace";
import "./shell.css";
import { useRead, useWorkspace } from "./useWorkspace";

export function App({ deps }: { deps?: SessionDeps } = {}) {
  return (
    <SessionProvider deps={deps}>
      <Root />
    </SessionProvider>
  );
}

function Root() {
  const [theme, setTheme] = useTheme();
  const [joined, setJoined] = useState(0);
  const onJoined = useCallback(() => setJoined((n) => n + 1), []);
  // The extension's handoffs come first: they stand in for the whole app.
  if (pendingNativeApproval()) {
    return (
      <Centered>
        <NativeApproval appName={`the ${PRODUCT} extension`} callback={NATIVE_APPROVE_CALLBACK} />
      </Centered>
    );
  }
  if (pendingNativeSignIn()) return <ExtensionSignIn />;
  return (
    <InvitationHost onJoined={onJoined}>
      <Screen key={joined} theme={theme} setTheme={setTheme} />
    </InvitationHost>
  );
}

/**
 * The extension opened this page to sign in (`#native-sign-in`, see
 * `native.ts`). Signed out: the passkey sign-in, said to be for the extension.
 * Signed in with no workspace yet: the person makes one here first, while the
 * page still holds the session (after the handoff it does not, so sending them
 * to the page later would mean signing in again). Then the session goes to the
 * extension, sealed to its key, and is forgotten here; Chrome closes the window
 * as the callback loads.
 */
export function ExtensionSignIn() {
  const { api } = useSessionApi();
  const session = api.session;
  const signedIn = useMaybeSignedIn();
  const [handed, setHanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `null` until known; `true` shows the workspace step before the handoff. */
  const [needsWorkspace, setNeedsWorkspace] = useState<boolean | null>(null);
  const started = useRef(false);
  const creating = signInIntent() === "create";
  const signingUp = signInIntent() === "signup";

  useEffect(() => {
    if (!signedIn || needsWorkspace !== null) return;
    if (creating) {
      setNeedsWorkspace(true);
      return;
    }
    let live = true;
    listWorkspaces(signedIn.client, signedIn.source)
      .then((rows) => {
        if (live) setNeedsWorkspace(rows.length === 0);
      })
      .catch(() => {
        if (live) setNeedsWorkspace(false);
      })
      .finally(signedIn.after);
    return () => {
      live = false;
    };
  }, [signedIn, needsWorkspace, creating]);

  useEffect(() => {
    if (session.status !== "signed-in" || needsWorkspace !== false || started.current) return;
    started.current = true;
    finishNativeSignIn({
      client: session.client,
      callback: NATIVE_CALLBACK,
      forgetHere: () => api.store?.clear(),
    })
      .then((done) => setHanded(done))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [session, api.store, needsWorkspace]);

  if (session.status === "signed-in" && needsWorkspace === true) {
    return (
      <Centered>
        <section className="handoff-workspace" data-testid="extension-workspace" aria-labelledby="handoff-title">
          <div className="card handoff">
            <h1 id="handoff-title">{creating ? "Create a workspace" : "Create your first workspace"}</h1>
            <p className="empty">
              The extension saves the meetings you record to a workspace. Start one now, and the extension
              switches to it when this window closes.
            </p>
            <button type="button" className="btn ghost" onClick={() => setNeedsWorkspace(false)}>
              {creating ? "Cancel" : "Skip for now"}
            </button>
          </div>
          <WorkspacePicker createOnly={creating} onOpen={() => setNeedsWorkspace(false)} />
        </section>
      </Centered>
    );
  }

  return (
    <Centered>
      <section className="card handoff" data-testid="extension-signin" aria-labelledby="handoff-title">
        <div className="handoff-mark" aria-hidden="true">
          <Icon name="puzzle" size={22} />
        </div>
        {session.status === "signed-in" ? (
          handed ? (
            <>
              <h1 id="handoff-title">You are signed in</h1>
              <p className="empty">The {PRODUCT} extension has your session. You can close this tab.</p>
            </>
          ) : (
            <>
              <h1 id="handoff-title">Signing you in to the {PRODUCT} extension…</h1>
              <p className="empty">This takes a moment. Keep this window open.</p>
            </>
          )
        ) : (
          <>
            <h1 id="handoff-title">
              {signingUp ? `Create your account for the ${PRODUCT} extension` : `Sign in to the ${PRODUCT} extension`}
            </h1>
            <p className="empty">
              {signingUp
                ? "Create an account with a passkey here, then make your first workspace. The extension saves the transcripts of the calls you record there, as you."
                : "Use your passkey here, or create an account if you are new. The extension then saves the transcripts of the calls you record to your workspaces, as you."}
            </p>
            {session.status === "connecting" ? <p className="empty">Connecting…</p> : <SignInPanel titleId="handoff-panel-title" />}
          </>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </section>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="centered">{children}</main>;
}

/** Whichever state the session is in. */
function Screen({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const [signingIn, setSigningIn] = useState(false);
  const [route, go] = useRoute();
  // Signed in, `#/home` is the landing page with the way back to the dashboard.
  if (route.page === "home" && signedIn) {
    return <Landing onDashboard={() => go({ page: "meetings" })} />;
  }
  // FAQ, privacy and terms read the same signed in or out, in the landing's frame.
  if (route.page === "doc") {
    return (
      <>
        <LandingPage onSignIn={signedIn ? undefined : () => setSigningIn(true)}>
          <InfoPage doc={route.doc} />
        </LandingPage>
        {!signedIn && <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />}
      </>
    );
  }
  if (api.session.status === "connecting") {
    return (
      <Shell>
        <div className="card">
          <p className="empty">Connecting…</p>
        </div>
      </Shell>
    );
  }
  if (!signedIn) {
    return (
      <>
        <SignedOutPages onSignIn={() => setSigningIn(true)} />
        <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
      </>
    );
  }
  return (
    <SignedInApp
      key={signedIn.accountId}
      theme={theme}
      setTheme={setTheme}
      onLogout={() => {
        // Recordings kept in this browser are the signed-in person's; they go when they sign out.
        void forgetWorkspaceRecordings();
        void signedIn.signOut();
      }}
    />
  );
}

/** Signed out: the front door, or the extension's install page (`#/install`). */
function SignedOutPages({ onSignIn }: { onSignIn: () => void }) {
  const [route, go] = useRoute();
  if (route.page === "install") {
    return (
      <LandingPage onSignIn={onSignIn}>
        <InstallPage onSignIn={onSignIn} />
      </LandingPage>
    );
  }
  return <Welcome onSignIn={onSignIn} onInstall={() => go({ page: "install" })} />;
}

/** The front door when signed out. */
export function Welcome({ onSignIn, onInstall }: { onSignIn: () => void; onInstall?: () => void }) {
  return <Landing onSignIn={onSignIn} onInstall={onInstall} />;
}

/** Signed in: the workspace picker, or the open workspace. */
function SignedInApp({ theme, setTheme, onLogout }: { theme: Theme; setTheme: (t: Theme) => void; onLogout: () => void }) {
  const { active, open, leaving } = useActiveWorkspace();
  const [lostNotice, setLostNotice] = useState(false);
  const { client, source, after, accountId } = useSignedIn();
  const [route, go] = useRoute();
  // How Sylence works: by itself the first time on this browser, then from the menu.
  const [tutorial, setTutorial] = useState(() => !tutorialSeen());
  const showTutorial = useCallback(() => setTutorial(true), []);
  const tutorialDialog = <Tutorial open={tutorial} onClose={() => setTutorial(false)} />;

  // A link to another workspace (`#/w/<appId>/...`, from the extension) opens it,
  // if this account reaches it; the picker shows otherwise.
  useEffect(() => {
    const wanted = linkedWorkspace(window.location.hash);
    if (!wanted || wanted === active?.appId) return;
    let live = true;
    listWorkspaces(client, source)
      .then((rows) => {
        const row = rows.find((w) => w.appId === wanted);
        if (live && row) open({ appId: row.appId, org: row.org });
      })
      .catch(() => undefined)
      .finally(after);
    return () => {
      live = false;
    };
    // `open` is a fresh function each render; the link is read once per workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, source, after, active?.appId]);

  if (leaving) return null;

  if (!active) {
    return (
      <Shell
        right={<Menu me={accountId} theme={theme} setTheme={setTheme} onLogout={onLogout} onShowTutorial={showTutorial} />}
        footer={<AppFooter workspace={false} onShowTutorial={showTutorial} />}
      >
        {tutorialDialog}
        {route.page === "install" ? (
          <InstallPage onBack={() => go({ page: "meetings" })} backLabel="Your workspaces" />
        ) : route.page === "profile" ? (
          <ProfilePage workspaceName={null} onLogout={onLogout} />
        ) : (
          <>
            {lostNotice && (
              <div className="card" role="status">
                <p className="empty">You no longer have access to that workspace.</p>
              </div>
            )}
            <WorkspacePicker
              onOpen={(w) => {
                setLostNotice(false);
                open(w);
              }}
            />
          </>
        )}
      </Shell>
    );
  }

  return (
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
        onLost={() => {
          window.location.hash = "";
          setLostNotice(true);
          open(null);
        }}
        onLogout={onLogout}
        onShowTutorial={showTutorial}
      />
      {tutorialDialog}
    </TeamNamespace>
  );
}

/**
 * The signed-in frame: the brand (it opens the home page), the workspace's
 * name, the account menu; the footer under everything. The node's security
 * badge lives on the Profile page, not up here.
 */
function Shell({ children, left, right, footer }: { children: ReactNode; left?: ReactNode; right?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="app-frame">
      <div className="wrap">
        <header className="topbar">
          <div className="brand">
            <a className="brand-link" href="#/home" title={`${PRODUCT} home page`}>
              <img src="./favicon.svg" alt="" width={26} height={26} />
              <span className="brand-name">{PRODUCT}</span>
            </a>
            {left}
          </div>
          <div className="topbar-right">{right}</div>
        </header>
        {children}
      </div>
      {footer}
    </div>
  );
}

function WorkspaceView({
  appId,
  org,
  theme,
  setTheme,
  onSwitchWorkspace,
  onLost,
  onLogout,
  onShowTutorial,
}: {
  appId: string;
  org: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchWorkspace: () => void;
  onLost: () => void;
  onLogout: () => void;
  onShowTutorial: () => void;
}) {
  const { client: calimero, source, accountId, after } = useSignedIn();
  const lostHere = useCallback(() => {
    // Recordings of a workspace this account no longer reaches are not kept.
    void forgetWorkspaceRecordings(appId);
    onLost();
  }, [appId, onLost]);
  const workspace = useWorkspace(appId, lostHere);
  const [route, go] = useRoute();
  const meetings = useRead(workspace.client, workspace.version, (c) => c.listMeetings(), []);
  const [owner, setOwner] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  /** What the last upload could not keep (its audio), shown over the meeting it opened. */
  const [uploadNote, setUploadNote] = useState<{ meetingId: string; note: string } | null>(null);

  useEffect(() => {
    let live = true;
    listWorkspaces(calimero, source)
      .then((rows) => {
        const row = rows.find((w) => w.appId === appId);
        if (!live || !row) return;
        setOwner(row.owner);
        setName(row.name);
      })
      .catch(() => undefined)
      .finally(after);
    return () => {
      live = false;
    };
  }, [calimero, source, appId, after]);

  const openActions = meetings.data?.reduce((n, m) => n + m.openActions, 0) ?? 0;
  // A recording kept in this browser whose meeting is gone, or whose audio was removed or
  // replaced (here or on another device), is dropped once the list says so.
  // The list holds the newest 1,000 meetings: past that it cannot say what older ones keep.
  const keptAudio = meetings.data && meetings.data.length < 1_000 ? meetings.data.flatMap((m) => (m.audio ? [m.audio.blob] : [])).sort().join(",") : null;
  useEffect(() => {
    if (keptAudio !== null) void pruneRecordings(appId, new Set(keptAudio ? keptAudio.split(",") : []));
  }, [appId, keptAudio]);
  const searchClient = workspace.client;
  const searchTranscripts = useCallback(
    async (query: string) => {
      if (!searchClient) return { hits: [], more: false };
      try {
        return await searchClient.search({ query, limit: 30 });
      } finally {
        after();
      }
    },
    [searchClient, after],
  );

  return (
    <Shell
      left={
        name ? (
          <span className="team-name">
            <span className="slash">/</span>
            {name}
          </span>
        ) : null
      }
      right={
        <Menu
          me={accountId}
          theme={theme}
          setTheme={setTheme}
          org={org}
          onSwitchWorkspace={onSwitchWorkspace}
          onLogout={onLogout}
          onShowTutorial={onShowTutorial}
        />
      }
      footer={<AppFooter onShowTutorial={onShowTutorial} />}
    >
      {(route.page === "meetings" || route.page === "actions" || route.page === "people") && (
        <nav className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={route.page === "meetings"}
            className={route.page === "meetings" ? "tab active" : "tab"}
            onClick={() => go({ page: "meetings" })}
          >
            Meetings
          </button>
          <button
            role="tab"
            aria-selected={route.page === "actions"}
            className={route.page === "actions" ? "tab active" : "tab"}
            onClick={() => go({ page: "actions" })}
          >
            Open action items
            {openActions > 0 && <span className="count">{openActions}</span>}
          </button>
          <button
            role="tab"
            aria-selected={route.page === "people"}
            className={route.page === "people" ? "tab active" : "tab"}
            onClick={() => go({ page: "people" })}
          >
            People
          </button>
        </nav>
      )}
      {route.page === "people" && <PeoplePage appId={appId} workspaceName={name} onLeft={onSwitchWorkspace} />}
      {route.page === "profile" && <ProfilePage workspaceName={name} onSwitchWorkspace={onSwitchWorkspace} onLogout={onLogout} />}
      {route.page === "meetings" && (
        <MeetingsList
          meetings={meetings.data}
          error={meetings.error}
          onOpen={(id, seq) => go(seq === undefined ? { page: "meeting", id } : { page: "meeting", id, seq })}
          searchTranscripts={searchTranscripts}
          onUpload={() => setUploading(true)}
        />
      )}
      {uploading && (
        <UploadRecording
          workspace={workspace}
          onClose={() => setUploading(false)}
          onDone={(id, note) => {
            setUploading(false);
            setUploadNote(note ? { meetingId: id, note } : null);
            go({ page: "meeting", id });
          }}
        />
      )}
      {route.page === "install" && <InstallPage onBack={() => go({ page: "meetings" })} backLabel="All meetings" />}
      {route.page === "actions" && <OpenActions workspace={workspace} onOpen={(id) => go({ page: "meeting", id })} />}
      {route.page === "meeting" && uploadNote?.meetingId === route.id && (
        <p className="notice" role="status">
          {uploadNote.note}{" "}
          <button type="button" className="btn small ghost" onClick={() => setUploadNote(null)}>
            Dismiss
          </button>
        </p>
      )}
      {route.page === "meeting" && (
        <MeetingPage
          key={route.id}
          workspace={workspace}
          meetingId={route.id}
          focusSeq={route.seq}
          me={accountId}
          isOwner={owner === accountId}
          onBack={() => go({ page: "meetings" })}
        />
      )}
    </Shell>
  );
}

/** Your avatar in the top bar: your name, theme, switch workspace, log out. */
function Menu({
  me,
  org,
  theme,
  setTheme,
  onSwitchWorkspace,
  onLogout,
  onShowTutorial,
}: {
  me?: string | null;
  org?: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchWorkspace?: () => void;
  onLogout: () => void;
  onShowTutorial?: () => void;
}) {
  const { api } = useSessionApi();
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
      <button className="menu-button" aria-label="account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="profile-icon">
          <Icon name="user" size={18} />
        </span>
      </button>
      {open && (
        <div className="menu-panel glass-float" role="menu">
          {me && nameOf(me) && (
            <div className="menu-section menu-who" data-testid="my-name">
              <span className="dim">Signed in as</span>
              <strong>
                <PersonName account={me} />
              </strong>
            </div>
          )}
          {me && org && (
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
                    publish(me, renaming);
                    setRenaming(null);
                  }}
                >
                  <input aria-label="your name" autoFocus maxLength={64} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
                  <button type="submit" className="btn small primary">
                    Save
                  </button>
                </form>
              )}
            </div>
          )}
          <div className="menu-section">
            <span className="menu-label">Theme</span>
            <div className="segmented" role="radiogroup" aria-label="theme">
              {(["system", "light", "dark"] as const).map((t) => (
                <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? "active" : ""} onClick={() => setTheme(t)}>
                  {t === "light" ? <Icon name="sun" size={14} /> : t === "dark" ? <Icon name="moon" size={14} /> : null}
                  {t[0]!.toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="menu-section">
            {me && (
              <a className="menu-item home-link" href="#/profile" onClick={() => setOpen(false)}>
                <Icon name="user" /> Profile
              </a>
            )}
            {me && org && (
              <a className="menu-item home-link" href="#/people" onClick={() => setOpen(false)}>
                <Icon name="users" /> People and invites
              </a>
            )}
            <a className="menu-item home-link" href="#/install" onClick={() => setOpen(false)}>
              <Icon name="puzzle" /> Get the extension
            </a>
            {onShowTutorial && (
              <button
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  onShowTutorial();
                }}
              >
                <Icon name="sparkle" /> Show tutorial
              </button>
            )}
            <a className="menu-item home-link" href="#/faq" onClick={() => setOpen(false)}>
              <Icon name="help" /> Help and FAQ
            </a>
            <a className="menu-item home-link" href="#/home" onClick={() => setOpen(false)}>
              <Icon name="home" /> {PRODUCT} home page
            </a>
            <ManageInHomeLink session={api.session} org={org} className="menu-item home-link" />
            {onSwitchWorkspace && (
              <button className="menu-item" onClick={onSwitchWorkspace}>
                Switch workspace
              </button>
            )}
            <button className="menu-item danger-text" onClick={onLogout}>
              <Icon name="logout" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
