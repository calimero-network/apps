import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckSquare } from "@calimero-network/mero-icons";
import { ManageInHomeLink, NativeApproval, NodeShield } from "@calimero-apps/passkey";
import { finishNativeSignIn, pendingNativeApproval, pendingNativeSignIn } from "@calimero-apps/passkey/native";
import { InstallAppIconButton } from "@calimero-apps/install";

import { MeetingPage } from "./MeetingPage";
import { MeetingsList } from "./MeetingsList";
import { OpenActions } from "./OpenActions";
import { InvitationHost, SignInModal, SignInPanel } from "./SignIn";
import { WorkspacePicker } from "./WorkspacePicker";
import { listWorkspaces } from "./lib/orgs";
import { NATIVE_APPROVE_CALLBACK, NATIVE_CALLBACK, signInIntent } from "./native";
import { PersonName, TeamNamespace, useSpaceNames } from "./names";
import { linkedWorkspace, useRoute } from "./route";
import { PRODUCT, type SessionDeps } from "./session";
import { SessionProvider, useMaybeSignedIn, useSessionApi, useSignedIn } from "./sessionContext";
import { Avatar, Icon, useTheme, type Theme } from "./ui";
import { useActiveWorkspace } from "./useActiveWorkspace";
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
            <h1 id="handoff-title">Sign in to the {PRODUCT} extension</h1>
            <p className="empty">
              Use your passkey here. The extension then saves the transcripts of the calls you record
              to your workspaces, as you.
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
        <Welcome onSignIn={() => setSigningIn(true)} />
        <SignInModal open={signingIn} onClose={() => setSigningIn(false)} />
      </>
    );
  }
  return <SignedInApp key={signedIn.accountId} theme={theme} setTheme={setTheme} onLogout={() => void signedIn.signOut()} />;
}

/** The front door when signed out. */
export function Welcome({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Shell>
      <section className="hero">
        <div className="hero-mark" aria-hidden="true">
          <Icon name="wave" size={30} />
        </div>
        <h1>Meeting notes that write themselves, privately.</h1>
        <p className="lede">
          {PRODUCT} records your Google Meet, Zoom and Teams calls from your browser, turns speech into
          text on your own laptop, and keeps the transcript and action items in your team&apos;s
          workspace. No bot joins the call, and the audio never leaves your machine.
        </p>
        <div className="row">
          <button type="button" className="btn primary large" onClick={onSignIn}>
            Sign in
          </button>
        </div>
        <ul className="features">
          <li>
            <Icon name="mic" />
            <span>
              <strong>On-device speech to text.</strong> Whisper large-v3-turbo on a GPU, a small fast model on any laptop.
            </span>
          </li>
          <li>
            <CheckSquare size={16} aria-hidden="true" />
            <span>
              <strong>Action items</strong> from any line of the transcript, ticked off by the team.
            </span>
          </li>
          <li>
            <Icon name="list" />
            <span>
              <strong>Searchable meetings</strong> in a workspace only your organization reaches.
            </span>
          </li>
        </ul>
      </section>
    </Shell>
  );
}

/** Signed in: the workspace picker, or the open workspace. */
function SignedInApp({ theme, setTheme, onLogout }: { theme: Theme; setTheme: (t: Theme) => void; onLogout: () => void }) {
  const { active, open, leaving } = useActiveWorkspace();
  const [lostNotice, setLostNotice] = useState(false);
  const { client, source, after } = useSignedIn();

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
      <Shell right={<Menu theme={theme} setTheme={setTheme} onLogout={onLogout} />}>
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
      />
    </TeamNamespace>
  );
}

function Shell({ children, left, right }: { children: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <img src="./favicon.svg" alt="" width={26} height={26} />
          <span className="brand-name">{PRODUCT}</span>
          {left}
        </div>
        <div className="topbar-right">
          <NodeShield compactBelow={720} />
          <InstallAppIconButton />
          {right}
        </div>
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
  onLost,
  onLogout,
}: {
  appId: string;
  org: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchWorkspace: () => void;
  onLost: () => void;
  onLogout: () => void;
}) {
  const { client: calimero, source, accountId, after } = useSignedIn();
  const workspace = useWorkspace(appId, onLost);
  const [route, go] = useRoute();
  const meetings = useRead(workspace.client, workspace.version, (c) => c.listMeetings(), []);
  const [owner, setOwner] = useState<string | null>(null);
  const [name, setName] = useState<string>("");

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
      right={<Menu me={accountId} theme={theme} setTheme={setTheme} org={org} onSwitchWorkspace={onSwitchWorkspace} onLogout={onLogout} />}
    >
      {route.page !== "meeting" && (
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
        </nav>
      )}
      {route.page === "meetings" && (
        <MeetingsList
          meetings={meetings.data}
          error={meetings.error}
          onOpen={(id, seq) => go(seq === undefined ? { page: "meeting", id } : { page: "meeting", id, seq })}
          searchTranscripts={searchTranscripts}
        />
      )}
      {route.page === "actions" && <OpenActions workspace={workspace} onOpen={(id) => go({ page: "meeting", id })} />}
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
}: {
  me?: string | null;
  org?: string | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onSwitchWorkspace?: () => void;
  onLogout: () => void;
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
        {me ? <Avatar account={me} size={30} /> : <Icon name="menu" />}
        {me && (
          <span className="menu-name" data-testid="my-name">
            <PersonName account={me} />
          </span>
        )}
      </button>
      {open && (
        <div className="menu-panel glass-float" role="menu">
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
            <ManageInHomeLink session={api.session} org={org} className="menu-item home-link" />
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
