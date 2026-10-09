import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { FeedView } from "./FeedView";
import { ControlsView } from "./ControlsView";
import { ChatView } from "./ChatView";
import { FeedPicker } from "./FeedPicker";
import { DemoBackend } from "./demo";
import { useFeed, type Feed } from "./useFeed";
import { useNodeFeed } from "./useNodeFeed";
import { demoPreview, nodePreview, type Preview } from "./preview";
import { useNewFeed } from "./newFeed";
import { appLink } from "./links";
import type { FeedItem } from "./generated/HyperfeedClient";
import { AGENT_LIVE_MS, useTheme } from "./theme";
import type { NewFeed } from "./FeedView";
import LandingPage from "./pages/landing/LandingPage";

/**
 * Two ways in, one set of screens.
 *
 * `/`, `/chat` and `/controls` run against your node: connect, open your
 * feed, and the collector starts watching your other contexts. `/demo`,
 * `/demo/chat` and `/demo/controls` run the same screens against `DemoBackend`, the contract's rules kept in
 * memory, so the app can be tried with no node at all.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NodeApp page="feed" />} />
        {/* The landing page's other two pages. Real routes, so a shared link
          opens cold instead of falling into the catch-all below. Signed in or
          not, they stay reference pages. */}
        <Route path="/docs" element={<LandingPage />} />
        <Route path="/preview" element={<LandingPage />} />
        <Route path="/chat/:chain?" element={<NodeApp page="chat" />} />
        <Route path="/controls" element={<NodeApp page="controls" />} />
        <Route path="/demo" element={<DemoApp page="feed" />} />
        <Route path="/demo/chat/:chain?" element={<DemoApp page="chat" />} />
        <Route path="/demo/controls" element={<DemoApp page="controls" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

type Page = "feed" | "chat" | "controls";

function NodeApp({ page }: { page: Page }) {
  const { isAuthenticated, isLoading, applicationId, contextId, nodeUrl, logout } = useMero();

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
  return <NodeFeedApp page={page} contextId={contextId} applicationId={applicationId} session={{ nodeUrl, logout }} />;
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
  const feed = useFeed(node.backend, node.nudge);
  const [query, setQuery] = useState("");
  const { mero, admin } = useMero();
  // A row's app, signed in to this node, at the row's context.
  const openLink = useCallback(
    async (item: FeedItem) => {
      const tokens = (mero as { getTokenData?: () => { access_token: string; refresh_token: string } | null } | null)?.getTokenData?.();
      const source = node.watching.find((s) => s.contextId === item.source_context);
      const groupId =
        item.app === "design" && admin
          ? ((await (admin as unknown as { getContextGroup(id: string): Promise<string | null> })
              .getContextGroup(item.source_context)
              .catch(() => null)) ?? undefined)
          : undefined;
      return appLink(item, {
        session: tokens && session.nodeUrl ? { nodeUrl: session.nodeUrl, accessToken: tokens.access_token, refreshToken: tokens.refresh_token } : null,
        applicationId: source?.applicationId,
        groupId,
      });
    },
    [mero, admin, node.watching, session.nodeUrl],
  );
  const watching =
    node.watchError != null
      ? `Not watching other apps: ${node.watchError}`
      : `Watching ${node.watching.length} other context${node.watching.length === 1 ? "" : "s"}`;
  return (
    <Shell base="" page={page} feed={feed} session={session} status={watching} query={query} onQuery={setQuery}>
      <Screen
        base=""
        page={page}
        feed={feed}
        contextId={contextId}
        query={query}
        preview={nodePreview(node)}
        newFeed={newFeed.ready ? newFeed : undefined}
        openLink={openLink}
      />
    </Shell>
  );
}

function DemoApp({ page }: { page: Page }) {
  // One demo per tab: it survives moving between the feed and the controls.
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
  demo ??= new DemoBackend();
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
}: {
  base: string;
  page: Page;
  feed: Feed;
  contextId: string | null;
  query: string;
  preview: Preview;
  newFeed?: NewFeed;
  openLink?: (item: FeedItem) => Promise<string | null>;
}) {
  const navigate = useNavigate();
  const { chain = "" } = useParams();
  const openChat = (c: string) => navigate(c ? `${base}/chat/${encodeURIComponent(c)}` : `${base}/chat`);
  if (page === "chat") return <ChatView feed={feed} chain={chain} onOpen={openChat} newFeed={newFeed} />;
  return page === "feed" ? (
    <FeedView feed={feed} query={query} newFeed={newFeed} onChat={openChat} openLink={openLink} />
  ) : (
    <ControlsView feed={feed} contextId={contextId} preview={preview} newFeed={newFeed} />
  );
}

function Shell({
  base,
  page,
  feed,
  session,
  status,
  extra,
  query,
  onQuery,
  children,
}: {
  base: string;
  page: Page;
  feed: Feed | null;
  session?: { nodeUrl: string | null; logout: () => void };
  status?: string;
  extra?: ReactNode;
  query?: string;
  onQuery?: (q: string) => void;
  children: ReactNode;
}) {
  const paused = feed?.settings?.paused ?? false;
  const [theme, toggleTheme] = useTheme();
  const agent = feed?.settings?.agents?.find((a) => Date.now() - a.seen_at < AGENT_LIVE_MS);
  return (
    <div className="shell">
      <header className="topbar">
        <Link to={base || "/"} className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <span>hyperfeed</span>
        </Link>
        {feed && (
          <nav className="topnav" aria-label="Pages">
            {(
              [
                ["feed", "Feed", base || "/"],
                ["chat", "Chat", `${base}/chat`],
                ["controls", "Controls", `${base}/controls`],
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
