import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { FeedView } from "./FeedView";
import { ControlsView } from "./ControlsView";
import { FeedPicker } from "./FeedPicker";
import { DemoBackend } from "./demo";
import { useFeed, type Feed } from "./useFeed";
import { useNodeFeed } from "./useNodeFeed";
import { demoPreview, nodePreview, type Preview } from "./preview";
import LandingPage from "./pages/landing/LandingPage";

/**
 * Two ways in, one set of screens.
 *
 * `/` and `/controls` run against your node: connect, open your feed, and the
 * collector starts watching your other contexts. `/demo` and `/demo/controls`
 * run the same screens against `DemoBackend`, the contract's rules kept in
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
        <Route path="/controls" element={<NodeApp page="controls" />} />
        <Route path="/demo" element={<DemoApp page="feed" />} />
        <Route path="/demo/controls" element={<DemoApp page="controls" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

type Page = "feed" | "controls";

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
  return <NodeFeedApp page={page} contextId={contextId} session={{ nodeUrl, logout }} />;
}

function NodeFeedApp({
  page,
  contextId,
  session,
}: {
  page: Page;
  contextId: string;
  session: { nodeUrl: string | null; logout: () => void };
}) {
  const node = useNodeFeed(contextId);
  const feed = useFeed(node.backend, node.nudge);
  const [query, setQuery] = useState("");
  const watching =
    node.watchError != null
      ? `Not watching other apps: ${node.watchError}`
      : `Watching ${node.watching.length} other context${node.watching.length === 1 ? "" : "s"}`;
  return (
    <Shell base="" page={page} feed={feed} session={session} status={watching} query={query} onQuery={setQuery}>
      <Screen page={page} feed={feed} contextId={contextId} query={query} preview={nodePreview(node)} />
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
      <Screen page={page} feed={feed} contextId={null} query={query} preview={DEMO_PREVIEW} />
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
  page,
  feed,
  contextId,
  query,
  preview,
}: {
  page: Page;
  feed: Feed;
  contextId: string | null;
  query: string;
  preview: Preview;
}) {
  return page === "feed" ? (
    <FeedView feed={feed} query={query} />
  ) : (
    <ControlsView feed={feed} contextId={contextId} preview={preview} />
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
            <Link className="button dark" to={page === "feed" ? `${base}/controls` : base || "/"}>
              {page === "feed" ? "Controls" : "Back to feed"}
            </Link>
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
