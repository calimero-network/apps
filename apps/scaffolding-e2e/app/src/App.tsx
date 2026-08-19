import React, { useState, useEffect, useRef, useCallback } from "react";
import { useMero } from "@calimero-network/mero-react";
import {
  clearContextId,
  discoverLocalNodes,
  getContextId,
  getNodeUrl,
  localNodeUrl,
  setContextId,
  setContextIdentity,
  setNodeUrl,
} from "./lib/mero";
import { listContexts, getContextIdentities, setUnauthorizedHandler, type ContextRecord } from "./api/adminApi";
import { Concepts } from "./sections/Concepts";
import { KvOperations } from "./sections/KvOperations";
import { KvHandlers } from "./sections/KvHandlers";
import { UserStorage } from "./sections/UserStorage";
import { FrozenStorage } from "./sections/FrozenStorage";
import { PrivateStorage } from "./sections/PrivateStorage";
import { BlobStorage } from "./sections/BlobStorage";
import { ContextMembers } from "./sections/ContextMembers";
import { CrdtCounters } from "./sections/CrdtCounters";
import { CrdtRegisters } from "./sections/CrdtRegisters";
import { CrdtMetadata } from "./sections/CrdtMetadata";
import { CrdtMetrics } from "./sections/CrdtMetrics";
import { CrdtTags } from "./sections/CrdtTags";
import { RgaDocument } from "./sections/RgaDocument";
import { WorkspaceManager } from "./sections/WorkspaceManager";
import { AuthoredMap } from "./sections/AuthoredMap";
import { AuthoredVector } from "./sections/AuthoredVector";
import { SharedStorage } from "./sections/SharedStorage";
import { SetupWizard } from "./sections/SetupWizard";
import { TestRunner } from "./sections/TestRunner";
import { SyncTest } from "./sections/SyncTest";
import { FileShareDemo } from "./sections/FileShareDemo";
import { TutorialButton } from "./components/Tutorial";

type SectionId =
  | "concepts"
  | "setup"
  | "workspace"
  | "tests"
  | "sync"
  | "kv"
  | "kv-handlers"
  | "user-storage"
  | "frozen"
  | "private"
  | "blobs"
  | "file-share"
  | "authored-map"
  | "authored-vector"
  | "shared-storage"
  | "members"
  | "counters"
  | "registers"
  | "metadata"
  | "metrics"
  | "tags"
  | "rga";

interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "concepts", label: "How It Works", icon: "◎", group: "Guide" },
  { id: "setup", label: "Setup Wizard", icon: "⚙", group: "Guide" },
  { id: "workspace", label: "Workspace Manager", icon: "🏢", group: "Guide" },
  { id: "tests", label: "Run All Tests", icon: "✓", group: "Guide" },
  { id: "sync", label: "Sync Test", icon: "⇄", group: "Guide" },
  { id: "kv", label: "KV Operations", icon: "◈", group: "Core" },
  { id: "kv-handlers", label: "KV Handlers", icon: "⚡", group: "Core" },
  { id: "user-storage", label: "User Storage", icon: "👤", group: "Storage" },
  { id: "frozen", label: "Frozen Storage", icon: "❄", group: "Storage" },
  { id: "private", label: "Private Secrets", icon: "🔒", group: "Storage" },
  { id: "blobs", label: "Blob Storage", icon: "📦", group: "Storage" },
  { id: "file-share", label: "File Share Demo", icon: "📂", group: "Storage" },
  { id: "authored-map", label: "Authored Map", icon: "✍", group: "Storage" },
  { id: "authored-vector", label: "Authored Vector", icon: "⬡", group: "Storage" },
  { id: "shared-storage", label: "Shared Storage", icon: "🔗", group: "Storage" },
  { id: "members", label: "Context Members", icon: "🛡", group: "Access" },
  { id: "counters", label: "Counters", icon: "🔢", group: "CRDT" },
  { id: "registers", label: "LWW Registers", icon: "📝", group: "CRDT" },
  { id: "metadata", label: "Nested Maps", icon: "🗂", group: "CRDT" },
  { id: "metrics", label: "Metrics Vector", icon: "📊", group: "CRDT" },
  { id: "tags", label: "Tags Set", icon: "🏷", group: "CRDT" },
  { id: "rga", label: "RGA Document", icon: "📄", group: "CRDT" },
];

const GROUPS = ["Guide", "Core", "Storage", "Access", "CRDT"];

function renderSection(id: SectionId) {
  switch (id) {
    case "concepts": return <Concepts />;
    case "setup": return <SetupWizard />;
    case "workspace": return <WorkspaceManager />;
    case "tests": return <TestRunner />;
    case "sync": return <SyncTest />;
    case "kv": return <KvOperations />;
    case "kv-handlers": return <KvHandlers />;
    case "user-storage": return <UserStorage />;
    case "frozen": return <FrozenStorage />;
    case "private": return <PrivateStorage />;
    case "blobs": return <BlobStorage />;
    case "file-share": return <FileShareDemo />;
    case "authored-map": return <AuthoredMap />;
    case "authored-vector": return <AuthoredVector />;
    case "shared-storage": return <SharedStorage />;
    case "members": return <ContextMembers />;
    case "counters": return <CrdtCounters />;
    case "registers": return <CrdtRegisters />;
    case "metadata": return <CrdtMetadata />;
    case "metrics": return <CrdtMetrics />;
    case "tags": return <CrdtTags />;
    case "rga": return <RgaDocument />;
  }
}

function ContextBar({ nodeUrl, contextId, onMenuToggle, children }: { nodeUrl: string | null; contextId: string | null; onMenuToggle?: () => void; children?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nodeUrl ?? "");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(getNodeUrl() ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed) {
      setNodeUrl(trimmed);
      // Update ?node= in the URL so the override survives a reload.
      const u = new URL(window.location.href);
      u.searchParams.set("node", trimmed);
      window.history.replaceState(null, "", u.toString());
    }
    setEditing(false);
  }

  const [nodeBPopover, setNodeBPopover] = useState(false);
  const [nodeBUrlCopied, setNodeBUrlCopied] = useState(false);

  function getNodeBUrl() {
    // `localNodeUrl(2528)` rather than a literal: one place decides what a local
    // node URL looks like, and it is the SDK's.
    const base = getNodeUrl() ?? localNodeUrl(2528);
    const suggested = base.replace(/(\d+)(?!.*\d)/, (m) => String(Number(m) + 1));
    const u = new URL(window.location.origin + window.location.pathname);
    u.searchParams.set("node", suggested);
    return u.toString();
  }

  function copyNodeBUrl() {
    navigator.clipboard.writeText(getNodeBUrl()).then(() => {
      setNodeBUrlCopied(true);
      setTimeout(() => setNodeBUrlCopied(false), 1500);
    });
  }

  function copyCtxId() {
    if (!contextId) return;
    navigator.clipboard.writeText(contextId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="context-bar" style={{ gap: 12, flexWrap: "wrap" as const }}>
      <button className="hamburger-btn" onClick={onMenuToggle} aria-label="Toggle menu">☰</button>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
        <span className="dot" />
        <span style={{ flexShrink: 0, color: "var(--color-text-muted)", fontSize: 11 }}>node:</span>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
            style={{
              background: "var(--color-bg-input)",
              border: "1px solid var(--color-brand-600)",
              borderRadius: 4,
              color: "var(--color-text-primary)",
              fontSize: 11,
              padding: "2px 6px",
              flex: 1,
              minWidth: 0,
              outline: "none",
            }}
          />
        ) : (
          <button
            data-tutorial="node-url"
            onClick={startEdit}
            title="Click to change node URL"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-primary)",
              fontSize: 11,
              padding: 0,
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap" as const,
              maxWidth: 260,
            }}
          >
            {nodeUrl ?? <em style={{ color: "var(--color-warning)" }}>not set</em>}
          </button>
        )}
      </span>

      {children}

      {contextId && (
        <button
          data-tutorial="ctx-id"
          onClick={copyCtxId}
          title="Copy context ID"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: 11,
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          ctx: <code style={{ fontSize: 10 }}>{contextId.slice(0, 16)}…</code>
          <span style={{ fontSize: 10 }}>{copied ? "✓" : "⎘"}</span>
        </button>
      )}

      <div data-tutorial="open-node-b" style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => setNodeBPopover((v) => !v)}
          style={{
            background: "var(--color-bg-input)",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
            color: "var(--color-text-muted)",
            fontSize: 11,
            padding: "3px 8px",
            cursor: "pointer",
            whiteSpace: "nowrap" as const,
          }}
        >
          Node B ↗
        </button>

        {nodeBPopover && (
          <>
            {/* Click-outside dismiss */}
            <div
              onClick={() => setNodeBPopover(false)}
              style={{ position: "fixed", inset: 0, zIndex: 100 }}
            />
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 101,
              width: 320, background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)", borderRadius: 8,
              padding: "14px 16px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6 }}>
                Open Node B
              </div>
              <p style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.6, margin: "0 0 10px" }}>
                Tabs share localStorage so they can't run as separate nodes. Open Node B using one of these options:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {[
                  { label: "Incognito / Private window", sub: "Ctrl+Shift+N (Chrome) / Cmd+Shift+N (Mac)" },
                  { label: "Different browser", sub: "e.g. Chrome for Node A, Firefox for Node B" },
                  { label: "Second frontend on :5174", sub: "Run a second dev server with a different VITE_NODE_URL" },
                ].map((opt) => (
                  <div key={opt.label} style={{
                    background: "var(--color-bg-input)", borderRadius: 5,
                    padding: "7px 10px", border: "1px solid var(--color-border)",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-primary)" }}>{opt.label}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 2 }}>{opt.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Node B URL:</div>
              <div style={{ display: "flex", gap: 6 }}>
                <code style={{
                  flex: 1, fontSize: 10, background: "var(--color-bg-input)",
                  border: "1px solid var(--color-border)", borderRadius: 4,
                  padding: "4px 8px", wordBreak: "break-all", color: "var(--color-text-primary)",
                }}>
                  {getNodeBUrl()}
                </code>
                <button
                  onClick={copyNodeBUrl}
                  style={{
                    background: "none", border: "1px solid var(--color-border)",
                    borderRadius: 4, color: "var(--color-text-muted)",
                    fontSize: 11, padding: "4px 10px", cursor: "pointer", flexShrink: 0,
                  }}
                >
                  {nodeBUrlCopied ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Exported for `ConnectScreen.test.tsx`; the app still renders it internally.
export function ConnectScreen() {
  // `connectToNode` replaces the old `login({ type, url })` — mero-react's login
  // modal has no Local/Remote tabs any more. That is NOT the same as "so the app
  // must supply the URL": the SDK ships port discovery (mero-js
  // `discoverLocalNodes`, re-exported by mero-react), and this screen used to
  // skip it and pre-fill a hardcoded `http://localhost:2528` instead. A typed
  // URL is one transposed digit from an "unreachable node" that is really a typo,
  // and it cannot find the second node of a two-node dev stack at all.
  const { connectToNode, isOnline } = useMero();
  const [url, setUrl] = useState(getNodeUrl() ?? import.meta.env.VITE_NODE_URL ?? "");
  /** `null` while probing; `[]` means nothing local answered. */
  const [found, setFound] = useState<string[] | null>(null);

  useEffect(() => {
    // Aborted on unmount so a slow probe cannot setState into a dead component.
    const ac = new AbortController();
    discoverLocalNodes({ signal: ac.signal })
      .then((urls) => setFound(urls))
      .catch(() => setFound([]));
    return () => ac.abort();
  }, []);

  const connect = useCallback(
    (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) return;
      setNodeUrl(trimmed);
      connectToNode(trimmed);
    },
    [connectToNode],
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg-primary)",
      }}
    >
      <div
        style={{
          width: 400,
          background: "var(--color-bg-card)",
          borderRadius: 10,
          padding: 32,
          border: "1px solid var(--color-border)",
        }}
      >
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--color-brand-600)",
              }}
            />
            <span style={{ fontWeight: 700, fontSize: 16 }}>Calimero</span>
          </div>
          <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
            Connect to a node to continue
          </div>
        </div>

        {/* Discovered nodes first — one click, nothing to type. */}
        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 8,
            }}
          >
            Local nodes
          </label>
          {found === null && (
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              Looking on ports 2428, 2429, 2528, 2529&hellip;
            </div>
          )}
          {found?.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              No local node answered. Start one with <code>merod</code>, or enter a
              URL below.
            </div>
          )}
          {found && found.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {found.map((u) => (
                <button
                  key={u}
                  className="btn-calimero"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    fontSize: 13,
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                  onClick={() => connect(u)}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--color-success, #43d17a)",
                      flex: "none",
                    }}
                  />
                  <code style={{ fontSize: 12 }}>{u}</code>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 8,
            }}
          >
            Or another node
          </label>
          <input
            className="form-control"
            style={{ width: "100%", boxSizing: "border-box" }}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect(url)}
            placeholder={localNodeUrl(2528)}
            />
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 7 }}>
            For a remote node, or a local one on a non-standard port. Pre-filled from{" "}
            <code>VITE_NODE_URL</code> when set.
          </div>
        </div>

        <button
          className="btn-calimero"
          style={{ width: "100%", padding: "10px 14px", fontSize: 13 }}
          onClick={() => connect(url)}
          disabled={!url.trim()}
        >
          Connect &amp; Login
        </button>

        {!isOnline && (
          <div
            style={{
              marginTop: 14,
              fontSize: 12,
              color: "var(--color-warning)",
              textAlign: "center",
            }}
          >
            Node unreachable — make sure <code>merod</code> is running
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid var(--color-border)",
            fontSize: 11,
            color: "var(--color-text-muted)",
            lineHeight: 1.6,
          }}
        >
          Redirects to the node's auth endpoint to get a JWT, then returns here.
          After that you'll pick a context.
        </div>
      </div>
    </div>
  );
}

async function applyContext(ctx: ContextRecord) {
  const identities = await getContextIdentities(ctx.id);
  setContextId(ctx.id);
  if (identities[0]) setContextIdentity(identities[0]);
}

export default function App() {
  const { isAuthenticated, logout } = useMero();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = useCallback(() => {
    clearContextId();
    setContextIdState(null);
    logout();
  }, [logout]);

  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
  }, [handleLogout]);
  const [active, setActive] = useState<SectionId>(
    () => (localStorage.getItem("calimero-active-tab") as SectionId) ?? "concepts",
  );

  function handleSetActive(id: SectionId) {
    setActive(id);
    setSidebarOpen(false);
    localStorage.setItem("calimero-active-tab", id);
  }
  const [contextId, setContextIdState] = useState<string | null>(getContextId);
  const [contexts, setContexts] = useState<ContextRecord[]>([]);

  const nodeUrl = getNodeUrl();

  // After auth, fetch all contexts and auto-select the preferred one.
  useEffect(() => {
    if (!isAuthenticated) return;

    const appId = (import.meta.env.VITE_APP_ID as string | undefined)?.trim();

    (async () => {
      try {
        const all = await listContexts();
        setContexts(all);
        if (!all.length) return;

        // If we already have a contextId that exists in the list, keep it.
        if (contextId && all.some((c) => c.id === contextId)) return;

        const preferred = (appId ? all.find((c) => c.applicationId === appId) : null) ?? all[0];
        await applyContext(preferred);
        setContextIdState(preferred.id);
      } catch (err) {
        console.error("Failed to load contexts:", err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  if (!isAuthenticated) return <ConnectScreen />;

  return (
    <div className="app-layout">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 199,
            background: "rgba(0,0,0,0.55)",
          }}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, color: "var(--color-brand-600)" }}>
              <path fillRule="evenodd" clipRule="evenodd" d="M1.99632 3.66395C10.2525 -1.05691 20.1869 0.184693 24.2979 1.44236C25.0644 1.67684 25.4946 2.48488 25.2588 3.24717C25.0231 4.00945 24.2106 4.43732 23.4441 4.20284C19.7461 3.07152 10.7334 1.99954 3.44373 6.16776C3.28333 6.25948 3.19314 6.42741 3.20159 6.60239C3.47851 12.3364 6.47521 23.2787 16.7996 28.9983C17.5001 29.3864 17.7517 30.2659 17.3615 30.9626C16.9712 31.6593 16.087 31.9095 15.3864 31.5214C3.84624 25.1282 0.603905 13.0137 0.300971 6.74094C0.239834 5.47501 0.899242 4.29125 1.99632 3.66395Z" fill="currentColor" />
              <path fillRule="evenodd" clipRule="evenodd" d="M29.5664 3.54671C30.3672 3.50486 31.0505 4.11657 31.0926 4.91301C31.6451 15.3703 26.1856 23.0399 22.6668 26.2841C21.7845 27.0975 20.4667 27.4148 19.261 26.8993C16.7595 25.8296 14.3382 23.5793 12.3718 21.3349C10.3763 19.0573 8.71015 16.623 7.73874 14.9886C7.33067 14.3021 7.55948 13.4165 8.2498 13.0107C8.94011 12.6048 9.83053 12.8324 10.2386 13.519C11.1313 15.0208 12.6959 17.3086 14.5612 19.4376C16.4557 21.5999 18.5252 23.4409 20.4081 24.246C20.4598 24.2681 20.5711 24.2781 20.6926 24.166C23.7736 21.3254 28.6877 14.4342 28.1926 5.06455C28.1506 4.26812 28.7656 3.58855 29.5664 3.54671Z" fill="currentColor" />
              <path fillRule="evenodd" clipRule="evenodd" d="M13.9626 9.08908C11.3729 9.35469 9.21144 9.9738 8.08636 10.4321C7.34428 10.7344 6.49632 10.3812 6.19237 9.64313C5.88843 8.90511 6.2436 8.06176 6.98567 7.75947C8.38535 7.18931 10.8191 6.50803 13.6647 6.21619C16.5123 5.92413 19.8708 6.01174 23.069 7.0678C24.4419 7.52113 25.4089 8.83201 25.3086 10.3389C25.1006 13.4629 23.6591 16.6571 20.7873 20.3175C20.294 20.9463 19.3816 21.0583 18.7494 20.5677C18.1171 20.0771 18.0045 19.1696 18.4978 18.5408C21.1716 15.1328 22.2556 12.4819 22.4109 10.1481C22.4192 10.0241 22.3408 9.87051 22.154 9.8088C19.4671 8.92157 16.5503 8.82369 13.9626 9.08908Z" fill="currentColor" />
            </svg>
            <span className="sidebar-logo-text">Calimero</span>
          </div>
          <div className="sidebar-subtitle">E2E Test Suite</div>
        </div>

        {GROUPS.map((group) => (
          <div className="sidebar-group" key={group}>
            <div className="sidebar-group-label">{group}</div>
            {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
              <button
                key={item.id}
                data-tutorial={
                  item.id === "concepts" ? "nav-concepts"
                  : item.id === "setup" ? "nav-setup"
                  : item.id === "kv" ? "nav-kv"
                  : item.id === "counters" ? "nav-counters"
                  : undefined
                }
                className={`sidebar-item${active === item.id ? " active" : ""}`}
                onClick={() => handleSetActive(item.id)}
              >
                <span className="sidebar-item-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}

        <div style={{ marginTop: "auto", padding: "12px 8px" }}>
          <button
            data-tutorial="logout"
            className="sidebar-item"
            style={{ width: "100%", color: "var(--color-warning)" }}
            onClick={handleLogout}
          >
            <span className="sidebar-item-icon">⏻</span>
            Logout
          </button>
        </div>
      </aside>

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Context info bar */}
        <ContextBar nodeUrl={nodeUrl} contextId={contextId} onMenuToggle={() => setSidebarOpen((v) => !v)}>
          {contexts.length > 1 && (
            <select
              data-tutorial="ctx-select"
              value={contextId ?? ""}
              onChange={async (e) => {
                const chosen = contexts.find((c) => c.id === e.target.value);
                if (!chosen) return;
                try {
                  await applyContext(chosen);
                  setContextIdState(chosen.id);
                } catch (err) {
                  console.error("Failed to switch context:", err);
                }
              }}
              style={{
                background: "var(--color-bg-input)",
                border: "1px solid var(--color-border)",
                borderRadius: 4,
                color: "var(--color-text-primary)",
                fontSize: 11,
                padding: "2px 6px",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {contexts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id.slice(0, 16)}… (app: {c.applicationId.slice(0, 8)}…)
                </option>
              ))}
            </select>
          )}
        </ContextBar>

        <main className="main-content">{renderSection(active)}</main>
      </div>

      <TutorialButton />
    </div>
  );
}
