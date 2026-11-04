import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalimeroError, type AppInfo } from "@calimero-network/mero-js";
import { appSource, describeError, type KeyValueStorage } from "@calimero-apps/connect";

import { setConnection } from "./lib/calimero";
import { PACKAGE, defaultDeps, describeTarget, useSession, type SessionDeps } from "./session";
import { dropInvite, pendingInvite, selectionKey } from "./instances";
import { SignIn } from "./SignIn";
import { InstancePicker } from "./InstancePicker";
import { Concepts } from "./sections/Concepts";
import { KvOperations } from "./sections/KvOperations";
import { KvHandlers } from "./sections/KvHandlers";
import { UserStorage } from "./sections/UserStorage";
import { FrozenStorage } from "./sections/FrozenStorage";
import { HostLogging } from "./sections/HostLogging";
import { PrivateStorage } from "./sections/PrivateStorage";
import { BlobStorage } from "./sections/BlobStorage";
import { ContextMembers } from "./sections/ContextMembers";
import { AccessControlSection } from "./sections/AccessControl";
import { CrdtCounters } from "./sections/CrdtCounters";
import { CrdtRegisters } from "./sections/CrdtRegisters";
import { CrdtMetadata } from "./sections/CrdtMetadata";
import { CrdtMetrics } from "./sections/CrdtMetrics";
import { CrdtTags } from "./sections/CrdtTags";
import { SortedCollections } from "./sections/SortedCollections";
import { RgaDocument } from "./sections/RgaDocument";
import { EphemeralPresence } from "./sections/EphemeralPresence";
import { WorkspaceManager } from "./sections/WorkspaceManager";
import { AuthoredMap } from "./sections/AuthoredMap";
import { AuthoredVector } from "./sections/AuthoredVector";
import { SharedStorage } from "./sections/SharedStorage";
import { SetupWizard } from "./sections/SetupWizard";
import { TestRunner } from "./sections/TestRunner";
import { FileShareDemo } from "./sections/FileShareDemo";
import { TutorialButton } from "./components/Tutorial";

/** The package production instances are created from (logic/Cargo.toml). */
export { PACKAGE };

type SectionId =
  | "concepts"
  | "setup"
  | "workspace"
  | "tests"
  | "kv"
  | "kv-handlers"
  | "logging"
  | "user-storage"
  | "frozen"
  | "private"
  | "blobs"
  | "file-share"
  | "authored-map"
  | "authored-vector"
  | "shared-storage"
  | "members"
  | "acl"
  | "counters"
  | "registers"
  | "metadata"
  | "metrics"
  | "tags"
  | "sorted"
  | "rga"
  | "ephemeral";

interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "concepts", label: "How It Works", icon: "◎", group: "Guide" },
  { id: "setup", label: "Setup", icon: "⚙", group: "Guide" },
  { id: "workspace", label: "Workspace Manager", icon: "▤", group: "Guide" },
  { id: "tests", label: "Run All Tests", icon: "✓", group: "Guide" },
  { id: "kv", label: "KV Operations", icon: "◈", group: "Core" },
  { id: "kv-handlers", label: "KV Handlers", icon: "⚡", group: "Core" },
  { id: "logging", label: "Host Logging", icon: "≡", group: "Core" },
  { id: "user-storage", label: "User Storage", icon: "◐", group: "Storage" },
  { id: "frozen", label: "Frozen Storage", icon: "❄", group: "Storage" },
  { id: "private", label: "Secrets Game", icon: "◆", group: "Storage" },
  { id: "blobs", label: "Blob Storage", icon: "▣", group: "Storage" },
  { id: "file-share", label: "File Share Demo", icon: "▢", group: "Storage" },
  { id: "authored-map", label: "Authored Map", icon: "✍", group: "Storage" },
  { id: "authored-vector", label: "Authored Vector", icon: "⬡", group: "Storage" },
  { id: "shared-storage", label: "Shared Storage", icon: "⇆", group: "Storage" },
  { id: "members", label: "Workspace Members", icon: "◉", group: "Access" },
  { id: "acl", label: "Roles & Ownership", icon: "⚿", group: "Access" },
  { id: "counters", label: "Counters", icon: "#", group: "Collections" },
  { id: "registers", label: "Registers", icon: "▭", group: "Collections" },
  { id: "metadata", label: "Nested Maps", icon: "⊞", group: "Collections" },
  { id: "metrics", label: "Metrics Vector", icon: "▥", group: "Collections" },
  { id: "tags", label: "Tags Set", icon: "◇", group: "Collections" },
  { id: "sorted", label: "Sorted Collections", icon: "↧", group: "Collections" },
  { id: "rga", label: "Text Document", icon: "¶", group: "Collections" },
  // Its own group on purpose: everything above is a contract call ordered by
  // the log. Presence runs no app code, is not logged, and expires.
  { id: "ephemeral", label: "Ephemeral Presence", icon: "◌", group: "Transient" },
];

const GROUPS = ["Guide", "Core", "Storage", "Access", "Collections", "Transient"];

function renderSection(id: SectionId) {
  switch (id) {
    case "concepts": return <Concepts />;
    case "setup": return <SetupWizard />;
    case "workspace": return <WorkspaceManager />;
    case "tests": return <TestRunner />;
    case "kv": return <KvOperations />;
    case "kv-handlers": return <KvHandlers />;
    case "logging": return <HostLogging />;
    case "user-storage": return <UserStorage />;
    case "frozen": return <FrozenStorage />;
    case "private": return <PrivateStorage />;
    case "blobs": return <BlobStorage />;
    case "file-share": return <FileShareDemo />;
    case "authored-map": return <AuthoredMap />;
    case "authored-vector": return <AuthoredVector />;
    case "shared-storage": return <SharedStorage />;
    case "members": return <ContextMembers />;
    case "acl": return <AccessControlSection />;
    case "counters": return <CrdtCounters />;
    case "registers": return <CrdtRegisters />;
    case "metadata": return <CrdtMetadata />;
    case "metrics": return <CrdtMetrics />;
    case "tags": return <CrdtTags />;
    case "sorted": return <SortedCollections />;
    case "rga": return <RgaDocument />;
    case "ephemeral": return <EphemeralPresence />;
  }
}

type Opened = Pick<AppInfo, "appId" | "name" | "org">;

function readSelection(storage: KeyValueStorage, key: string): Opened | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as Opened).appId === "string") {
      return parsed as Opened;
    }
  } catch {
    /* nothing usable stored */
  }
  return null;
}

function isSection(id: string | null): id is SectionId {
  return !!id && NAV_ITEMS.some((n) => n.id === id);
}

function ContextBar({
  where,
  opened,
  onChange,
  onMenuToggle,
}: {
  where: string;
  opened: Opened | null;
  onChange: () => void;
  onMenuToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyId() {
    if (!opened) return;
    void navigator.clipboard?.writeText(opened.appId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="context-bar" style={{ gap: 12, flexWrap: "wrap" as const }}>
      <button className="hamburger-btn" onClick={onMenuToggle} aria-label="Toggle menu">☰</button>
      <span data-tutorial="node-url" style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
        <span className="dot" />
        <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>{where}</span>
      </span>
      {opened && (
        <button
          data-tutorial="ctx-id"
          onClick={copyId}
          title="Copy the instance id"
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
          {opened.name} · <code style={{ fontSize: 10 }}>{opened.appId.slice(0, 16)}…</code>
          <span style={{ fontSize: 10 }}>{copied ? "✓" : "⎘"}</span>
        </button>
      )}
      {opened && (
        <button
          data-tutorial="ctx-select"
          className="btn-calimero-outline"
          style={{ fontSize: 11, padding: "3px 10px" }}
          onClick={onChange}
        >
          Change instance
        </button>
      )}
    </div>
  );
}

export default function App({
  deps = defaultDeps,
  storage = globalThis.localStorage,
}: {
  deps?: SessionDeps;
  storage?: KeyValueStorage;
}) {
  // Memoised: a new object every render would reconnect every render.
  const sessionDeps = useMemo(
    () => (storage === deps.storage || !storage ? deps : { ...deps, storage }),
    [deps, storage],
  );
  const api = useSession(sessionDeps);
  const { session, store } = api;
  const source = useMemo(() => appSource(deps.env, PACKAGE), [deps.env]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [active, setActive] = useState<SectionId>(() => {
    let stored: string | null = null;
    try {
      stored = storage?.getItem("calimero-active-tab") ?? null;
    } catch {
      /* per page only */
    }
    return isSection(stored) ? stored : "concepts";
  });

  const client = session.status === "signed-in" ? session.client : null;
  const accountId = session.status === "signed-in" ? session.accountId : null;
  const key = session.status === "signed-in" ? selectionKey(session.target, session.accountId) : null;
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  // The instance opened last time, on this target, by this account.
  useEffect(() => {
    setOpened(key ? readSelection(storage, key) : null);
  }, [key, storage]);

  // What every section calls through. Set during render, not in an effect, so
  // a section's own first effect already sees it.
  useMemo(() => {
    setConnection(
      client && opened && accountId
        ? { client, appId: opened.appId, org: opened.org, accountId, after }
        : null,
    );
  }, [client, opened, accountId, after]);

  const open = useCallback(
    (app: Opened | null) => {
      setOpened(app);
      if (!key) return;
      try {
        if (app) storage.setItem(key, JSON.stringify({ appId: app.appId, name: app.name, org: app.org }));
        else storage.removeItem(key);
      } catch {
        /* remembered for this page only */
      }
    },
    [key, storage],
  );

  // An invitation link opened before signing in is redeemed once a session exists.
  useEffect(() => {
    if (!client) return;
    const token = pendingInvite(storage);
    if (!token) return;
    let live = true;
    client
      .redeemInvite(token)
      .then(() => {
        dropInvite(storage);
        if (live) {
          setNotice("Invitation accepted: the shared instance is in your list.");
          setPickerKey((k) => k + 1);
        }
      })
      .catch((e: unknown) => {
        // A refusal (used, expired, revoked) can never succeed: drop it. Anything
        // else (the cluster unreachable) is kept and tried on the next load.
        if (e instanceof CalimeroError && e.status < 500) dropInvite(storage);
        if (live) setNotice(`The invitation could not be accepted: ${describeError(e)}`);
      })
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, storage, after]);

  function handleSetActive(id: SectionId) {
    setActive(id);
    setSidebarOpen(false);
    try {
      storage?.setItem("calimero-active-tab", id);
    } catch {
      /* per page only */
    }
  }

  if (session.status !== "signed-in") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 440 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span className="dot" />
            <span style={{ fontWeight: 700, fontSize: 16 }}>Calimero — E2E Test Suite</span>
          </div>
          {session.status === "connecting" && <div className="method-card">Connecting…</div>}
          {session.status === "unconfigured" && (
            <div className="method-card">
              <div className="method-name">Cannot connect</div>
              <pre className="result-box error">{session.message}</pre>
            </div>
          )}
          {session.status === "signed-out" && <SignIn api={api} where={describeTarget(session.target)} />}
        </div>
      </div>
    );
  }

  const needsInstance = !opened && active !== "concepts";

  return (
    <div className="app-layout">
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,0.55)" }}
        />
      )}

      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span className="dot" style={{ width: 12, height: 12 }} />
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
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", padding: "0 8px 8px", wordBreak: "break-all" as const }}>
            account <code>{session.accountId}</code>
          </div>
          <button
            data-tutorial="logout"
            className="sidebar-item"
            style={{ width: "100%", color: "var(--color-warning)" }}
            onClick={() => {
              open(null);
              void api.signOut();
            }}
          >
            <span className="sidebar-item-icon">⏻</span>
            Sign out
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <ContextBar
          where={describeTarget(session.target)}
          opened={opened}
          onChange={() => open(null)}
          onMenuToggle={() => setSidebarOpen((v) => !v)}
        />

        {notice && (
          <div className="alert alert-warning" style={{ margin: "12px 16px" }}>
            {notice}
          </div>
        )}

        <main className="main-content">
          {needsInstance ? (
            <div>
              <div className="section-header">
                <h2 className="section-title">Pick an app instance</h2>
                <p className="section-desc">
                  Every section calls one instance of this app (v1&apos;s context). Open one your
                  account reaches, or create one: a shared instance lives in an organization of its
                  own, which you can invite a second account into from Setup.
                </p>
              </div>
              <InstancePicker key={pickerKey} client={session.client} source={source} onOpen={open} after={after} />
            </div>
          ) : (
            <React.Fragment key={opened?.appId ?? "none"}>{renderSection(active)}</React.Fragment>
          )}
        </main>
      </div>

      <TutorialButton />
    </div>
  );
}
