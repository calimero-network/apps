import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { FeedView } from "./FeedView";
import { SettingsView, settingsSection } from "./SettingsView";
import { ChatView } from "./ChatView";
import { TeamView } from "./TeamView";
import { BriefView } from "./BriefView";
import { FeedPicker, FeedSwitcher } from "./FeedPicker";
import { DemoBackend } from "./demo";
import { useFeed, type Feed } from "./useFeed";
import { useNodeFeed } from "./useNodeFeed";
import { demoPreview, nodePreview, type Preview } from "./preview";
import { useNewFeed, useOpenFeed } from "./newFeed";
import { appHome, appLink, linkNamer, type Session } from "./links";
import type { FeedItem } from "./generated/HyperfeedClient";
import { AGENT_LIVE_MS, useTheme } from "./theme";
import { useAttention } from "./useAttention";
import { NeedsYou, opensAt, waitingCount } from "./NeedsYou";
import type { NewFeed } from "./FeedView";
import LandingPage from "./pages/landing/LandingPage";
import DocsPage from "./pages/landing/DocsPage";
import { BrandLockup } from "./brand";
import { AppLauncher } from "./AppLauncher";

/**
 * Two ways in, one set of screens.
 *
 * `/`, `/chat` and `/settings` run against your node: connect, open your
 * feed, and the collector starts watching your other contexts. The feed
 * opens on Brief; Lanes and Team are a click away. `/demo`,
 * `/demo/chat` and `/demo/settings` run the same screens against `DemoBackend`, the contract's rules kept in
 * memory, so the app can be tried with no node at all. Settings has a section
 * per path segment (`/settings/agents`), and `/controls` lands on its first.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NodeApp page="feed" />} />
        {/* Hyperfeed's own docs, signed in or not. /preview was the shared
          template's animation page; the landing's hero is that now. */}
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/preview" element={<Navigate to="/" replace />} />
        <Route path="/chat/:chain?" element={<NodeApp page="chat" />} />
        <Route path="/settings/:section?" element={<NodeApp page="settings" />} />
        {/* Controls became one section of Settings: old links still land. */}
        <Route path="/controls" element={<Navigate to="/settings/controls" replace />} />
        <Route path="/demo" element={<DemoApp page="feed" />} />
        <Route path="/demo/chat/:chain?" element={<DemoApp page="chat" />} />
        <Route path="/demo/settings/:section?" element={<DemoApp page="settings" />} />
        <Route path="/demo/controls" element={<Navigate to="/demo/settings/controls" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

type Page = "feed" | "chat" | "settings";

function NodeApp({ page }: { page: Page }) {
  const { isAuthenticated, isLoading, applicationId, contextId: sessionFeed, nodeUrl, logout } = useMero();
  const contextId = useOpenFeed(sessionFeed);

  if (isLoading) {
    return (
      <Shell base="" page={page} feed={null}>
        <div className="empty">Connecting…</div>
      </Shell>
    );
  }
  // Signed out, the front door is the shared landing page; its Connect to
  // node opens the login popup over it. The demo is linked from /docs.
  if (!isAuthenticated) return <LandingPage />;
  if (!contextId) {
    return (
      <Shell base="" page={page} feed={null} session={{ nodeUrl, logout }}>
        <FeedPicker applicationId={applicationId} />
      </Shell>
    );
  }
  // Keyed by feed: switching starts the new feed's screens fresh.
  return <NodeFeedApp key={contextId} page={page} contextId={contextId} applicationId={applicationId} session={{ nodeUrl, logout }} />;
}

function NodeFeedApp({
  page,
  contextId,
  applicationId,
  session,
}: {
  page: Page;
  contextId: string;
  applicationId: string | null;
  session: { nodeUrl: string | null; logout: () => void };
}) {
  const node = useNodeFeed(contextId);
  const newFeed = useNewFeed(applicationId);
  const base = useFeed(node.backend, node.nudge);
  // Each chat a task touched, named from the chat ("#launch", "DM with Ronit"), read in its own context.
  const nameLink = useMemo(() => linkNamer(node.hostFor), [node.hostFor]);
  // A person by name, read as a lens reads one: from namespace member metadata.
  const { hostFor } = node;
  const namePerson = useCallback(
    (identity: string) => hostFor(contextId)?.name(identity) ?? Promise.resolve(""),
    [hostFor, contextId],
  );
  const feed = useMemo(() => ({ ...base, nameLink, namePerson }), [base, nameLink, namePerson]);
  const [query, setQuery] = useState("");
  const { mero, admin } = useMero();
  // Your session on this node now, as the apps' login hash takes it.
  const appSession = useCallback((): Session | null => {
    const tokens = (mero as { getTokenData?: () => { access_token: string; refresh_token: string } | null } | null)?.getTokenData?.();
    return tokens && session.nodeUrl ? { nodeUrl: session.nodeUrl, accessToken: tokens.access_token, refreshToken: tokens.refresh_token } : null;
  }, [mero, session.nodeUrl]);
  // A row's app, signed in to this node, at the row's context.
  const openLink = useCallback(
    async (item: FeedItem) => {
      const source = node.watching.find((s) => s.contextId === item.source_context);
      const groupId =
        item.app === "design" && admin
          ? ((await (admin as unknown as { getContextGroup(id: string): Promise<string | null> })
              .getContextGroup(item.source_context)
              .catch(() => null)) ?? undefined)
          : undefined;
      return appLink(item, {
        session: appSession(),
        applicationId: source?.applicationId,
        groupId,
      });
    },
    [appSession, admin, node.watching],
  );
  const navigate = useNavigate();
  const launcher = (
    <AppLauncher
      installed={node.installed}
      href={appHome}
      onInstall={node.install ? () => navigate("/settings/controls") : undefined}
    />
  );
  const watching =
    node.watchError != null
      ? `Not watching other apps: ${node.watchError}`
      : `Watching ${node.watching.length} other context${node.watching.length === 1 ? "" : "s"}`;
  return (
    <Shell
      base=""
      page={page}
      feed={feed}
      session={session}
      status={watching}
      query={query}
      onQuery={setQuery}
      launcher={launcher}
      switcher={<FeedSwitcher applicationId={applicationId} current={contextId} />}
    >
      <Screen
        base=""
        page={page}
        feed={feed}
        contextId={contextId}
        query={query}
        preview={nodePreview(node)}
        newFeed={newFeed.ready ? newFeed : undefined}
        openLink={openLink}
        installed={node.installed}
        install={node.install}
      />
    </Shell>
  );
}

function DemoApp({ page }: { page: Page }) {
  // One demo per tab: it survives moving between the feed and settings.
  const backend = useMemo(() => demoSingleton(), []);
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  const [query, setQuery] = useState("");
  return (
    <Shell
      base="/demo"
      query={query}
      onQuery={setQuery}
      page={page}
      feed={feed}
      status="Demo · nothing leaves this tab"
      launcher={<AppLauncher installed={null} href={appHome} />}
      extra={
        <button type="button" className="ghost small" onClick={() => void backend.simulateAgent()}>
          Simulate agent
        </button>
      }
    >
      <Screen base="/demo" page={page} feed={feed} contextId={null} query={query} preview={DEMO_PREVIEW} />
    </Shell>
  );
}

const DEMO_PREVIEW = demoPreview();

let demo: DemoBackend | null = null;
function demoSingleton(): DemoBackend {
  if (!demo) {
    demo = new DemoBackend();
    // Two agents for Settings → Agents: a private one in a TEE, and a laptop on Claude with your repos.
    const line = (attested: boolean, folders: { path: string; write: boolean }[]) => ({
      serves: "default",
      profile: attested ? "near" : "claude",
      model: attested ? "z-ai/glm-5.3-flash" : "",
      attested,
      folders,
      shell: !attested,
      web: !attested,
    });
    demo.agentReach("mero-bot@agent-td", [line(true, [])]);
    demo.agentReach("mero-bot@laptop", [line(false, [{ path: "~/workspace", write: true }])]);
  }
  return demo;
}

function Screen({
  base,
  page,
  feed,
  contextId,
  query,
  preview,
  newFeed,
  openLink,
  installed = null,
  install = null,
}: {
  base: string;
  page: Page;
  feed: Feed;
  contextId: string | null;
  query: string;
  preview: Preview;
  newFeed?: NewFeed;
  openLink?: (item: FeedItem) => Promise<string | null>;
  /** The apps installed on your node; null in the demo. */
  installed?: string[] | null;
  /** Install an app on your node by its package; null in the demo. */
  install?: ((pkg: string) => Promise<void>) | null;
}) {
  const navigate = useNavigate();
  const { chain = "", section } = useParams();
  const openChat = (c: string) => navigate(c ? `${base}/chat/${encodeURIComponent(c)}` : `${base}/chat`);
  const [view, setView] = useFeedView();
  // The bell opens a row in place: `?open=<chain>`, read once by the feed, in Lanes or Team.
  const [params, setParams] = useSearchParams();
  const focus = page === "feed" ? (params.get("open") ?? "") : "";
  const focused = useCallback(
    () =>
      setParams(
        (p) => {
          p.delete("open");
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  if (page === "chat") return <ChatView feed={feed} chain={chain} onOpen={openChat} newFeed={newFeed} />;
  if (page === "settings")
    return (
      <SettingsView
        feed={feed}
        contextId={contextId}
        preview={preview}
        newFeed={newFeed}
        section={settingsSection(section)}
        base={base}
        installed={installed}
        install={install}
      />
    );
  return (
    <>
      <div className="view-switch" role="group" aria-label="How the feed is laid out">
        {(
          [
            ["brief", "Brief"],
            ["lanes", "Lanes"],
            ["team", "Team"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
      </div>
      {view === "brief" ? (
        <BriefView feed={feed} query={query} onChat={openChat} feedKey={contextId ?? ""} focus={focus} onFocused={focused} />
      ) : view === "team" ? (
        <TeamView feed={feed} query={query} onChat={openChat} focus={focus} onFocused={focused} />
      ) : (
        <FeedView feed={feed} query={query} newFeed={newFeed} onChat={openChat} openLink={openLink} focus={focus} onFocused={focused} />
      )}
    </>
  );
}

type FeedLayout = "brief" | "lanes" | "team";
const VIEW_KEY = "hyperfeed:view";
const LAYOUTS: readonly FeedLayout[] = ["brief", "lanes", "team"];
const layoutOf = (v: string | null): FeedLayout | null => (LAYOUTS.includes(v as FeedLayout) ? (v as FeedLayout) : null);

/**
 * Brief, Lanes or Team, remembered in this browser. `?view=lanes` picks one
 * from a link. Brief until you pick another.
 */
function useFeedView(): [FeedLayout, (v: FeedLayout) => void] {
  const [view, setView] = useState<FeedLayout>(() => {
    const linked = layoutOf(new URLSearchParams(window.location.search).get("view"));
    if (linked) return linked;
    try {
      return layoutOf(localStorage.getItem(VIEW_KEY)) ?? "brief";
    } catch {
      return "brief";
    }
  });
  const pick = useCallback((v: FeedLayout) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: it holds for this visit.
    }
  }, []);
  return [view, pick];
}

function Shell({
  base,
  page,
  feed,
  session,
  status,
  extra,
  launcher,
  query,
  onQuery,
  switcher,
  children,
}: {
  base: string;
  page: Page;
  feed: Feed | null;
  session?: { nodeUrl: string | null; logout: () => void };
  status?: string;
  extra?: ReactNode;
  /** The apps grid, beside the bell. */
  launcher?: ReactNode;
  query?: string;
  onQuery?: (q: string) => void;
  /** The feed switcher, beside the brand, when a feed on your node is open. */
  switcher?: ReactNode;
  children: ReactNode;
}) {
  const paused = feed?.settings?.paused ?? false;
  const [theme, toggleTheme] = useTheme();
  const agent = feed?.settings?.agents?.find((a) => Date.now() - a.seen_at < AGENT_LIVE_MS);
  const waiting = waitingCount(feed);
  const attention = useAttention(feed?.page ?? null, base, waiting);
  const [needsOpen, setNeedsOpen] = useState(false);
  const closeNeeds = useCallback(() => setNeedsOpen(false), []);
  const navigate = useNavigate();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to={base || "/"} className="brand">
          <BrandLockup size={24} />
        </Link>
        {switcher}
        {feed && (
          <nav className="topnav" aria-label="Pages">
            {(
              [
                ["feed", "Feed", base || "/"],
                ["chat", "Chat", `${base}/chat`],
                ["settings", "Settings", `${base}/settings`],
              ] as const
            ).map(([p, label, to]) => (
              <Link key={p} className={p === page ? "on" : ""} to={to} aria-current={p === page ? "page" : undefined}>
                {label}
              </Link>
            ))}
          </nav>
        )}
        {feed && onQuery && page === "feed" && (
          <div className="search">
            <label htmlFor="hf-search" className="sr-only">
              Search the feed
            </label>
            <input
              id="hf-search"
              type="search"
              placeholder="Search…"
              value={query ?? ""}
              onChange={(e) => onQuery(e.target.value)}
            />
          </div>
        )}
        <div className="topbar-end">
          {feed?.settings && (
            <span
              className={`pill ${paused ? "pill-wait" : agent ? "pill-good" : "pill-bad"}`}
              title={paused ? "Writes wait for you" : agent ? `${agent.name}${status ? ` · ${status}` : ""}` : "Start mero-bot against this feed"}
            >
              {paused ? "Agent paused" : agent ? "Agent live" : "No agent connected"}
            </span>
          )}
          {feed?.settings && (
            <button type="button" className="ghost small" disabled={feed.busy} onClick={() => void feed.setPaused(!paused)}>
              {paused ? "Resume" : "Pause"}
            </button>
          )}
          {extra}
          {feed && launcher}
          {feed && (
            <div className="needs-wrap">
              <button
                type="button"
                className={`icon-button needs-bell ${waiting > 0 ? "on" : ""}`}
                aria-expanded={needsOpen}
                aria-haspopup="dialog"
                aria-label={waiting > 0 ? `Needs you: ${waiting}` : "Needs you: nothing"}
                title={waiting > 0 ? `${waiting} waiting for you` : "Nothing waits for you"}
                onClick={() => setNeedsOpen((o) => !o)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={waiting > 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {waiting > 0 && <span className="needs-count">{waiting > 99 ? "99+" : waiting}</span>}
              </button>
              {needsOpen && (
                <NeedsYou
                  feed={feed}
                  attention={attention}
                  onClose={closeNeeds}
                  onSettings={(section) => {
                    setNeedsOpen(false);
                    navigate(`${base}/settings/${section}`);
                  }}
                  onOpen={(item) => {
                    setNeedsOpen(false);
                    navigate(opensAt(base, item));
                  }}
                />
              )}
            </div>
          )}
          <button type="button" className="icon-button" aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"} onClick={toggleTheme}>
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
              </svg>
            )}
          </button>
          {session && (
            <button type="button" className="ghost small" title={session.nodeUrl ?? ""} onClick={session.logout}>
              Log out
            </button>
          )}
        </div>
      </header>
      <div className="page">{children}</div>
    </div>
  );
}
