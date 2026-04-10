import { useState, useEffect } from "react";
import {
  getAccessToken,
  getContextId,
  getAppEndpointKey,
  setContextId,
  setExecutorPublicKey,
  clearContextId,
  useCalimero,
  ConnectionType,
} from "@calimero-network/calimero-client";
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
import { TestRunner } from "./sections/TestRunner";

type SectionId =
  | "concepts"
  | "workspace"
  | "tests"
  | "kv"
  | "kv-handlers"
  | "user-storage"
  | "frozen"
  | "private"
  | "blobs"
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
  { id: "workspace", label: "Workspace Manager", icon: "🏢", group: "Guide" },
  { id: "tests", label: "Run All Tests", icon: "✓", group: "Guide" },
  { id: "kv", label: "KV Operations", icon: "◈", group: "Core" },
  { id: "kv-handlers", label: "KV Handlers", icon: "⚡", group: "Core" },
  { id: "user-storage", label: "User Storage", icon: "👤", group: "Storage" },
  { id: "frozen", label: "Frozen Storage", icon: "❄", group: "Storage" },
  { id: "private", label: "Private Secrets", icon: "🔒", group: "Storage" },
  { id: "blobs", label: "Blob Storage", icon: "📦", group: "Storage" },
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
    case "workspace": return <WorkspaceManager />;
    case "tests": return <TestRunner />;
    case "kv": return <KvOperations />;
    case "kv-handlers": return <KvHandlers />;
    case "user-storage": return <UserStorage />;
    case "frozen": return <FrozenStorage />;
    case "private": return <PrivateStorage />;
    case "blobs": return <BlobStorage />;
    case "members": return <ContextMembers />;
    case "counters": return <CrdtCounters />;
    case "registers": return <CrdtRegisters />;
    case "metadata": return <CrdtMetadata />;
    case "metrics": return <CrdtMetrics />;
    case "tags": return <CrdtTags />;
    case "rga": return <RgaDocument />;
  }
}

function ConnectScreen() {
  const { login, isOnline } = useCalimero();
  const [url, setUrl] = useState(
    getAppEndpointKey() ?? import.meta.env.VITE_NODE_URL ?? "http://localhost:2528",
  );

  function connect() {
    const trimmed = url.trim();
    if (!trimmed) return;
    login({ type: ConnectionType.Custom, url: trimmed });
  }

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
            Node URL
          </label>
          <input
            className="form-control"
            style={{ width: "100%", boxSizing: "border-box" }}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            placeholder="http://localhost:2528"
            autoFocus
          />
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 7 }}>
            Pre-filled from <code>VITE_NODE_URL</code>. Edit if your node is on a different host.
          </div>
        </div>

        <button
          className="btn-calimero"
          style={{ width: "100%", padding: "10px 14px", fontSize: 13 }}
          onClick={connect}
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

export default function App() {
  const { isAuthenticated, logout } = useCalimero();

  function handleLogout() {
    clearContextId();
    setContextIdState(null);
    logout();
  }
  const [active, setActive] = useState<SectionId>("concepts");
  const [contextId, setContextIdState] = useState<string | null>(getContextId);

  const nodeUrl = getAppEndpointKey();

  // After auth, if no context-id is stored, auto-select the first context that
  // belongs to this app from the node's admin API.
  useEffect(() => {
    if (!isAuthenticated || contextId) return;

    const nodeUrl = getAppEndpointKey();
    const token = getAccessToken();
    if (!nodeUrl || !token) return;

    const appId = (import.meta.env.VITE_APP_ID as string | undefined)?.trim();

    (async () => {
      try {
        const ctxRes = await fetch(`${nodeUrl}/admin-api/contexts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!ctxRes.ok) return;
        const ctxBody = await ctxRes.json() as { data?: { contexts?: Array<{ id: string; applicationId: string }> } };
        const contexts = ctxBody?.data?.contexts ?? [];

        const ctx = (appId ? contexts.find((c) => c.applicationId === appId) : null) ?? contexts[0];
        if (!ctx) return;

        const idRes = await fetch(`${nodeUrl}/admin-api/contexts/${ctx.id}/identities-owned`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!idRes.ok) return;
        const idBody = await idRes.json() as { data?: { identities?: string[] } };
        const identity = idBody?.data?.identities?.[0];

        setContextId(ctx.id);
        if (identity) setExecutorPublicKey(identity);
        setContextIdState(ctx.id);
      } catch (err) {
        console.error("Failed to auto-select context:", err);
      }
    })();
  }, [isAuthenticated, contextId]);

  if (!isAuthenticated) return <ConnectScreen />;

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-dot" />
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
                className={`sidebar-item${active === item.id ? " active" : ""}`}
                onClick={() => setActive(item.id)}
              >
                <span className="sidebar-item-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ))}

        <div style={{ marginTop: "auto", padding: "12px 8px" }}>
          <button
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
        <div className="context-bar">
          <span>
            <span className="dot" />
            node:{" "}
            {nodeUrl ?? (
              <em style={{ color: "var(--color-warning)" }}>
                not set — open from desktop app or set VITE_NODE_URL
              </em>
            )}
          </span>
          {contextId && (
            <span>
              ctx:{" "}
              <code style={{ fontSize: 10 }}>{contextId.slice(0, 16)}…</code>
            </span>
          )}
        </div>

        <main className="main-content">{renderSection(active)}</main>
      </div>
    </div>
  );
}
