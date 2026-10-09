import { useEffect, useMemo, useState, type ReactNode } from "react";
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
        <button type="button" className="ghost" onClick={() => void backend.simulateAgent()}>
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
}: {
  base: string;
  page: Page;
  feed: Feed;
  contextId: string | null;
  query: string;
  preview: Preview;
  newFeed?: NewFeed;
}) {
  const navigate = useNavigate();
  const { chain = "" } = useParams();
  const openChat = (c: string) => navigate(c ? `${base}/chat/${encodeURIComponent(c)}` : `${base}/chat`);
  if (page === "chat") return <ChatView feed={feed} chain={chain} onOpen={openChat} newFeed={newFeed} />;
  return page === "feed" ? (
    <FeedView feed={feed} query={query} newFeed={newFeed} onChat={openChat} />
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
  return (
    <div className="shell">
      <header className="topbar">
        <Link to={base || "/"} className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>hyperfeed</span>
        </Link>
        {feed && onQuery && page === "feed" && (
          <div className="search">
            <label htmlFor="hf-search" className="sr-only">
              Search the feed
            </label>
            <input
              id="hf-search"
              type="search"
              placeholder="Search actions, people, apps…"
              value={query ?? ""}
              onChange={(e) => onQuery(e.target.value)}
            />
          </div>
        )}
        <div className="topbar-end">
          {status && <span className="status-text">{status}</span>}
          {feed?.settings && (
            <span className={`pill ${paused ? "pill-wait" : "pill-good"}`}>
              {paused ? "Agent paused · writes wait for you" : "Agent active"}
            </span>
          )}
          {feed?.settings && (
            <button type="button" className="ghost" disabled={feed.busy} onClick={() => void feed.setPaused(!paused)}>
              {paused ? "Resume agent" : "Pause agent"}
            </button>
          )}
          {extra}
          {feed && (
            <nav className="topnav" aria-label="Pages">
              {(
                [
                  ["feed", "Feed", base || "/"],
                  ["chat", "Chat", `${base}/chat`],
                  ["controls", "Controls", `${base}/controls`],
                ] as const
              ).map(([p, label, to]) => (
                <Link key={p} className={`button${p === page ? " dark" : ""}`} to={to} aria-current={p === page ? "page" : undefined}>
                  {label}
                </Link>
              ))}
            </nav>
          )}
          {session && (
            <button type="button" className="ghost" title={session.nodeUrl ?? ""} onClick={session.logout}>
              Log out
            </button>
          )}
        </div>
      </header>
      <div className="page">{children}</div>
    </div>
  );
}
