import React from "react";
import { useState, useEffect } from "react";
import {
  getContextId,
  setContextId,
  setContextIdentity,
} from "../lib/mero";
import {
  listContexts,
  createContext,
  deleteContext,
  getContextIdentities,
  createNamespace,
  deleteNamespace,
  listNamespaces,
  createGroup,
  deleteGroup,
  listGroups,
  createNamespaceInvitation,
  joinNamespace,
  joinContextById,
  type ContextRecord,
  type NamespaceRecord,
  type GroupRecord,
} from "../api/adminApi";
import { wsInit, wsGetInfo, type WorkspaceInfo } from "../api/kvStore";
import { FieldHelp } from "../components/FieldHelp";

const C = {
  card: "var(--color-bg-card)",
  surface: "var(--color-bg-input)",
  border: "var(--color-border)",
  text: "var(--color-text-primary)",
  muted: "var(--color-text-muted)",
  brand: "var(--color-brand-600)",
  warning: "var(--color-warning)",
};

// ─── Compact encoding (base64url) ─────────────────────────────────────────────
// btoa/atob are native and reliable; custom base58 bignum had rounding bugs.

function invToCompact(inv: object): string {
  const json = JSON.stringify(inv);
  let binary = "";
  for (const b of new TextEncoder().encode(json)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function compactToInv(s: string): object {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Compact JSON: arrays stay on one line, objects expand one key per line
function compactJson(val: unknown, depth = 0): string {
  if (Array.isArray(val)) return "[" + val.map((v) => JSON.stringify(v)).join(", ") + "]";
  if (val !== null && typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (!entries.length) return "{}";
    const pad = "  ".repeat(depth + 1);
    const lines = entries.map(([k, v]) => `${pad}"${k}": ${compactJson(v, depth + 1)}`);
    return `{\n${lines.join(",\n")}\n${"  ".repeat(depth)}}`;
  }
  return JSON.stringify(val);
}

// ─── Shared tab component ──────────────────────────────────────────────────────

function Tabs({ tabs, active, onSelect }: { tabs: string[]; active: string; onSelect: (t: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 0, borderBottom: `1px solid ${C.border}` }}>
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onSelect(t)}
          style={{
            background: active === t ? C.surface : "transparent",
            border: "none",
            borderBottom: active === t ? `2px solid ${C.brand}` : "2px solid transparent",
            color: active === t ? C.text : C.muted,
            fontSize: 12, fontWeight: active === t ? 600 : 400,
            padding: "7px 16px", cursor: "pointer",
            transition: "color 0.15s, border-color 0.15s",
            marginBottom: -1,
          }}
        >{t}</button>
      ))}
    </div>
  );
}

function extractOutput<T>(res: unknown): T | null {
  return (res as { result?: { output?: T } })?.result?.output ?? null;
}
function extractError(res: unknown): string | null {
  return (res as { error?: { message?: string } })?.error?.message ?? null;
}

type StepStatus = "pending" | "active" | "done";

function StepCard({
  num, title, status, open, onToggle, children,
}: {
  num: number; title: string; status: StepStatus;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const borderColor = status === "active" ? C.brand : hovered ? C.brand + "80" : C.border;
  const headerBg = hovered ? "rgba(165,255,17,0.04)" : "transparent";

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${borderColor}`,
      borderRadius: 10, marginBottom: 12, overflow: "hidden",
      transition: "border-color 0.15s",
    }}>
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          background: headerBg, border: "none", cursor: "pointer",
          padding: "14px 20px", textAlign: "left", transition: "background 0.15s",
        }}
      >
        <span style={{
          width: 26, height: 26, borderRadius: "50%",
          background: status === "done" ? C.brand : status === "active" ? C.brand : "transparent",
          border: `2px solid ${status === "pending" ? C.border : C.brand}`,
          color: status === "pending" ? C.muted : "#000",
          fontSize: 12, fontWeight: 700, display: "inline-flex",
          alignItems: "center", justifyContent: "center", flexShrink: 0,
          transition: "background 0.15s, border-color 0.15s",
        }}>
          {status === "done" ? "✓" : num}
        </span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: status === "pending" ? C.muted : C.text }}>
          {title}
        </span>
        <span style={{
          color: hovered ? C.brand : C.muted, fontSize: 14,
          transform: open ? "rotate(180deg)" : "none",
          display: "inline-block", transition: "transform 0.2s, color 0.15s",
        }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: "0 20px 20px 20px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ paddingTop: 16 }}>{children}</div>
        </div>
      )}
    </div>
  );
}

// ─── Namespace/Context flow diagram ───────────────────────────────────────────

function FlowDiagram() {
  const boxBase: React.CSSProperties = {
    borderRadius: 8, padding: "10px 14px", textAlign: "center",
    fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
  };
  const arrow = (label: string, vertical = false) => (
    <div style={{
      display: "flex", flexDirection: vertical ? "column" : "row",
      alignItems: "center", gap: 3,
      ...(vertical ? { margin: "0 auto", width: 0 } : { padding: "0 4px" }),
    }}>
      <div style={{
        fontSize: 10, color: C.muted, fontStyle: "italic", whiteSpace: "nowrap",
        ...(vertical ? { writingMode: "horizontal-tb", marginBottom: 2 } : {}),
      }}>{label}</div>
      <span style={{ color: C.brand, fontSize: 16 }}>{vertical ? "↓" : "→"}</span>
    </div>
  );

  return (
    <div style={{
      background: "rgba(165,255,17,0.03)", border: `1px solid rgba(165,255,17,0.15)`,
      borderRadius: 10, padding: "20px 16px", marginBottom: 20,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.brand, letterSpacing: 1, textTransform: "uppercase", marginBottom: 16 }}>
        How groups, namespaces, contexts &amp; invitations connect
      </div>

      {/* Top row: Owner flow */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        <div style={{ ...boxBase, background: "rgba(59,130,246,0.12)", border: "1.5px solid #3b82f6", color: "#60a5fa" }}>
          Node A<br /><span style={{ fontSize: 10, fontWeight: 400 }}>(owner)</span>
        </div>
        {arrow("creates")}
        <div style={{ ...boxBase, background: "rgba(139,92,246,0.12)", border: "1.5px solid #8b5cf6", color: "#a78bfa" }}>
          Namespace<br /><span style={{ fontSize: 10, fontWeight: 400 }}>application group</span>
        </div>
        {arrow("creates")}
        <div style={{ ...boxBase, background: "rgba(165,255,17,0.1)", border: `1.5px solid ${C.brand}`, color: C.brand }}>
          Context<br /><span style={{ fontSize: 10, fontWeight: 400 }}>WASM instance</span>
        </div>
        {arrow("generates")}
        <div style={{ ...boxBase, background: "rgba(245,158,11,0.1)", border: "1.5px solid #f59e0b", color: "#fbbf24" }}>
          Invitation<br /><span style={{ fontSize: 10, fontWeight: 400 }}>signed token</span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px dashed rgba(165,255,17,0.15)`, margin: "12px 0" }} />

      {/* Bottom row: Joiner flow */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 4 }}>
        <div style={{ ...boxBase, background: "rgba(59,130,246,0.08)", border: "1.5px solid #3b82f680", color: "#93c5fd" }}>
          Node B<br /><span style={{ fontSize: 10, fontWeight: 400 }}>(joiner)</span>
        </div>
        {arrow("pastes invitation →")}
        <div style={{ ...boxBase, background: "rgba(139,92,246,0.08)", border: "1.5px solid #8b5cf680", color: "#c4b5fd" }}>
          joins Namespace
        </div>
        {arrow("then")}
        <div style={{ ...boxBase, background: "rgba(165,255,17,0.06)", border: `1.5px dashed ${C.brand}80`, color: C.brand }}>
          joins Context
        </div>
        {arrow("↔ CRDT sync")}
        <div style={{ ...boxBase, background: "rgba(59,130,246,0.12)", border: "1.5px solid #3b82f6", color: "#60a5fa" }}>
          Node A<br /><span style={{ fontSize: 10, fontWeight: 400 }}>state shared</span>
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: C.muted, lineHeight: 1.6, textAlign: "center" }}>
        Every namespace requires an invitation — there are no public groups.<br />
        Without a valid signed token from the owner, Node B cannot join.
      </div>
    </div>
  );
}

function Intro({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: "0 0 16px 0" }}>{children}</p>;
}
function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 6 }}>
      {children}
    </div>
  );
}
function OK({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.brand + "18", border: `1px solid ${C.brand}44`, borderRadius: 6, padding: "10px 14px", fontSize: 12, color: C.brand, marginTop: 12 }}>
      {children}
    </div>
  );
}
function Err({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.warning + "18", border: `1px solid ${C.warning}44`, borderRadius: 6, padding: "10px 14px", fontSize: 12, color: C.warning, marginTop: 12 }}>
      {children}
    </div>
  );
}
function CopyBox({ value, label, onCopy }: { value: string; label: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <Label>{label}</Label>
        <button type="button" onClick={copy} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <code style={{ display: "block", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 11, color: C.text, wordBreak: "break-all" as const, lineHeight: 1.5 }}>
        {value}
      </code>
    </div>
  );
}

// ─── Shared step 4: ws_init ───────────────────────────────────────────────────

function StepWorkspace({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [existing, setExisting] = useState<WorkspaceInfo | null>(null);
  const [noContext, setNoContext] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await wsGetInfo();
        const out = extractOutput<WorkspaceInfo>(res);
        if (out) { setExisting(out); onDone(); }
      } catch (e) {
        // If no context is active, the RPC call will fail — surface this clearly
        if (String(e).includes("context") || String(e).includes("executor") || String(e).includes("401") || String(e).includes("403")) {
          setNoContext(true);
        }
      } finally { setChecking(false); }
    })();
  }, []);

  async function initialize() {
    if (!name.trim()) return;
    setLoading(true); setErr(null); setOk(null);
    try {
      const res = await wsInit(name.trim());
      const e = extractError(res);
      if (e) { setErr(e); return; }
      const infoRes = await wsGetInfo();
      const info = extractOutput<WorkspaceInfo>(infoRes);
      setExisting(info);
      setOk(info ? `Workspace "${info.name}" initialized. Admin: ${info.admin.slice(0, 20)}…` : "Done.");
      onDone();
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }

  if (checking) return <p style={{ color: C.muted, fontSize: 13 }}>Checking…</p>;

  return (
    <>
      <div style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 7, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.65 }}>
        <strong style={{ color: "var(--color-text-primary)" }}>What is this?</strong> The Workspace Manager is a demo CRDT feature built into this app's WASM contract.
        Initializing it calls <code>ws_init</code> on the running context and sets up the root state for the Workspace Manager section.
        <br />
        <strong style={{ color: "var(--color-text-primary)" }}>Skip this if</strong> you only want to test KV operations, storage, or other CRDT types — those work without a workspace.
        You must have an active context (Step 2 → click <em>Use</em>) before initializing.
      </div>

      {noContext && (
        <Err>No active context — complete Step 2 and click <strong>Use</strong> on a context first.</Err>
      )}

      {existing ? (
        <OK>Already initialized: <strong>{existing.name}</strong> — admin: <code style={{ fontSize: 11 }}>{existing.admin.slice(0, 20)}…</code></OK>
      ) : !noContext ? (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="form-control" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && initialize()} placeholder="Workspace name, e.g. My Workspace" />
            <button className="btn-calimero" onClick={initialize} disabled={loading || !name.trim()}>{loading ? "Initializing…" : "Initialize"}</button>
          </div>
          {ok && <OK>{ok}</OK>}
          {err && <Err>{err}</Err>}
        </>
      ) : null}
    </>
  );
}

// ─── OWNER FLOW (Node A) ──────────────────────────────────────────────────────

function OwnerStep1Namespace({
  onDone,
}: { onDone: (nsId: string, appId: string) => void }) {
  const [namespaces, setNamespaces] = useState<NamespaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [appId, setAppId] = useState((import.meta.env.VITE_APP_ID as string | undefined)?.trim() ?? "");
  const [selectedNs, setSelectedNs] = useState<NamespaceRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listNamespaces()
      .then((ns) => {
        setNamespaces(ns);
        if (!ns.length) return;
        const envAppId = (import.meta.env.VITE_APP_ID as string | undefined)?.trim();
        const preferred = (envAppId ? ns.find((n) => n.targetApplicationId === envAppId) : null) ?? ns[0];
        setSelectedNs(preferred);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function reload() {
    const fresh = await listNamespaces().catch(() => null);
    if (fresh) setNamespaces(fresh);
  }

  async function create() {
    if (!appId.trim()) return;
    setCreating(true); setErr(null);
    try {
      const { namespaceId } = await createNamespace(appId.trim());
      const fresh = await listNamespaces();
      const merged = fresh.some((n) => n.namespaceId === namespaceId)
        ? fresh
        : [{ namespaceId, targetApplicationId: appId.trim(), memberCount: 1, contextCount: 0 }, ...fresh];
      setNamespaces(merged);
      setSelectedNs({ namespaceId, targetApplicationId: appId.trim(), memberCount: 1, contextCount: 0 });
    } catch (e) { setErr(String(e)); } finally { setCreating(false); }
  }

  async function remove(namespaceId: string) {
    setDeleting(true); setErr(null);
    try {
      await deleteNamespace(namespaceId);
      if (selectedNs?.namespaceId === namespaceId) setSelectedNs(null);
      setNamespaces((prev) => prev.filter((n) => n.namespaceId !== namespaceId));
    } catch (e) { setErr(String(e)); } finally { setDeleting(false); setConfirmDeleteId(null); }
  }

  function select(ns: NamespaceRecord) {
    setSelectedNs(ns);
  }

  return (
    <>
      <div style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 7, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.muted, lineHeight: 1.65 }}>
        <strong style={{ color: "var(--color-text-primary)" }}>Namespace = Group.</strong>{" "}
        In Calimero's admin API, what <code>meroctl</code> calls <code>--group-id</code> is the namespace ID.
        There is no separate "create group" step — creating a namespace <em>is</em> creating the group.
        The namespace ties one application ID to a membership list and controls who can join via signed invitations.
      </div>

      {loading ? (
        <p style={{ color: C.muted, fontSize: 13 }}>Loading namespaces…</p>
      ) : namespaces.length > 0 ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.surface }}>
                {["Namespace / Group ID", "App ID", "Members", "Contexts", ""].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase" as const, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {namespaces.map((ns, i) => (
                <tr key={ns.namespaceId} style={{ borderBottom: i < namespaces.length - 1 ? `1px solid ${C.border}` : "none", background: ns.namespaceId === selectedNs?.namespaceId ? C.brand + "10" : "transparent" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <code style={{ fontSize: 11 }}>{ns.namespaceId.slice(0, 20)}…</code>
                      {ns.namespaceId === selectedNs?.namespaceId && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 10, background: C.brand + "22", color: C.brand, border: `1px solid ${C.brand}55`, whiteSpace: "nowrap" as const }}>selected</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.muted }}><code style={{ fontSize: 11 }}>{ns.targetApplicationId.slice(0, 16)}…</code></td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.muted }}>{ns.memberCount}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.muted }}>{ns.contextCount}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {confirmDeleteId === ns.namespaceId ? (
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: C.warning }}>Delete?</span>
                        <button style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: C.warning, border: "none", color: "#000", cursor: "pointer", fontWeight: 600 }} onClick={() => remove(ns.namespaceId)} disabled={deleting}>{deleting ? "…" : "Yes"}</button>
                        <button style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer" }} onClick={() => setConfirmDeleteId(null)}>No</button>
                      </span>
                    ) : (
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button className={ns.namespaceId === selectedNs?.namespaceId ? "btn-calimero-outline" : "btn-calimero"} style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => select(ns)}>
                          {ns.namespaceId === selectedNs?.namespaceId ? "Selected ✓" : "Use"}
                        </button>
                        <button style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer" }} onClick={() => setConfirmDeleteId(ns.namespaceId)}>🗑</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10 }}>Create new namespace (group)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="form-control" style={{ flex: 1 }} value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="Application ID" />
          <FieldHelp text="Your app's application ID — get it from: meroctl app ls, or set VITE_APP_ID in .env. It was output when you ran meroctl app install." />
          <button className="btn-calimero" onClick={create} disabled={creating || !appId.trim()}>{creating ? "Creating…" : "Create Namespace"}</button>
        </div>
      </div>
      {err && <Err>{err}</Err>}
      {selectedNs && (
        <>
          <CopyBox
            value={selectedNs.namespaceId}
            label="Selected Namespace / Group ID"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button className="btn-calimero" onClick={() => onDone(selectedNs.namespaceId, selectedNs.targetApplicationId)}>
              Continue to Step 2 →
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ─── OWNER STEP 2: Group ─────────────────────────────────────────────────────

function OwnerStep2Group({
  namespaceId, onDone,
}: { namespaceId: string; onDone: (groupId: string) => void }) {
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [alias, setAlias] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!namespaceId) { setLoading(false); return; }
    listGroups(namespaceId)
      .then((gs) => {
        setGroups(gs);
        if (gs.length) setSelectedGroupId(gs[0].groupId);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [namespaceId]);

  async function reload() {
    if (!namespaceId) return;
    const fresh = await listGroups(namespaceId).catch(() => null);
    if (fresh) setGroups(fresh);
  }

  async function create() {
    setCreating(true); setErr(null);
    try {
      const { groupId } = await createGroup(namespaceId, alias.trim() || undefined);
      const fresh = await listGroups(namespaceId);
      const merged = fresh.some((g) => g.groupId === groupId)
        ? fresh
        : [{ groupId, alias: alias.trim() || undefined }, ...fresh];
      setGroups(merged);
      setSelectedGroupId(groupId);
    } catch (e) { setErr(String(e)); } finally { setCreating(false); }
  }

  async function remove(groupId: string) {
    setDeleting(true); setErr(null);
    try {
      await deleteGroup(groupId);
      if (selectedGroupId === groupId) setSelectedGroupId(null);
      setGroups((prev) => prev.filter((g) => g.groupId !== groupId));
    } catch (e) { setErr(String(e)); } finally { setDeleting(false); setConfirmDeleteId(null); }
  }

  function select(g: GroupRecord) {
    setSelectedGroupId(g.groupId);
  }

  if (!namespaceId) return <Err>Complete Step 1 first — select or create a namespace.</Err>;

  return (
    <>
      <Intro>
        Groups are child units inside a namespace — they own contexts and control membership at a finer grain.
        Create at least one group; contexts will be created inside it in Step 3.
        Equivalent to <code>meroctl namespace create-group &lt;namespace_id&gt;</code>.
      </Intro>

      {loading ? (
        <p style={{ color: C.muted, fontSize: 13 }}>Loading groups…</p>
      ) : groups.length > 0 ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.surface }}>
                {["Group ID", "Alias", "Members", "Contexts", ""].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase" as const, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={g.groupId} style={{ borderBottom: i < groups.length - 1 ? `1px solid ${C.border}` : "none", background: g.groupId === selectedGroupId ? C.brand + "10" : "transparent" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <code style={{ fontSize: 11 }}>{g.groupId.slice(0, 20)}…</code>
                      {g.groupId === selectedGroupId && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 10, background: C.brand + "22", color: C.brand, border: `1px solid ${C.brand}55`, whiteSpace: "nowrap" as const }}>selected</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.muted }}>{g.alias ?? <em>—</em>}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.muted }}>{g.memberCount ?? "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.muted }}>{g.contextCount ?? "—"}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {confirmDeleteId === g.groupId ? (
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: C.warning }}>Delete?</span>
                        <button style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: C.warning, border: "none", color: "#000", cursor: "pointer", fontWeight: 600 }} onClick={() => remove(g.groupId)} disabled={deleting}>{deleting ? "…" : "Yes"}</button>
                        <button style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer" }} onClick={() => setConfirmDeleteId(null)}>No</button>
                      </span>
                    ) : (
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button className={g.groupId === selectedGroupId ? "btn-calimero-outline" : "btn-calimero"} style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => select(g)}>
                          {g.groupId === selectedGroupId ? "Selected ✓" : "Use"}
                        </button>
                        <button style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer" }} onClick={() => setConfirmDeleteId(g.groupId)}>🗑</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !loading ? (
        <p style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>No groups yet — create one below.</p>
      ) : null}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10 }}>Create new group</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="form-control" style={{ flex: 1 }} value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Alias (optional, e.g. main-group)" />
          <button className="btn-calimero" onClick={create} disabled={creating}>{creating ? "Creating…" : "Create Group"}</button>
        </div>
      </div>
      {err && <Err>{err}</Err>}
      {selectedGroupId && (
        <>
          <CopyBox
            value={selectedGroupId}
            label="Selected Group ID"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button className="btn-calimero" onClick={() => onDone(selectedGroupId)}>
              Continue to Step 3 →
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ─── OWNER STEP 3: Context ────────────────────────────────────────────────────

function OwnerStep2Context({
  groupId, appId, onDone,
}: { groupId: string; appId: string; onDone: (ctxId: string) => void }) {
  const [contexts, setContexts] = useState<ContextRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedCtxId, setSelectedCtxId] = useState<string | null>(getContextId);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listContexts().then(setContexts).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, []);

  async function reload() {
    const fresh = await listContexts().catch(() => null);
    if (fresh) setContexts(fresh);
  }

  async function removeCtx(contextId: string) {
    setDeleting(true); setErr(null);
    try {
      await deleteContext(contextId);
      if (selectedCtxId === contextId) setSelectedCtxId(null);
      setContexts((prev) => prev.filter((c) => c.id !== contextId));
    } catch (e) { setErr(String(e)); } finally { setDeleting(false); setConfirmDeleteId(null); }
  }

  async function create() {
    if (!groupId.trim() || !appId.trim()) { setErr("Group ID and App ID are required. Complete Steps 1 and 2 first."); return; }
    setCreating(true); setErr(null);
    try {
      const { contextId } = await createContext(appId.trim(), groupId.trim());
      const fresh = await listContexts();
      // Guard against race condition
      const merged = fresh.some((c) => c.id === contextId)
        ? fresh
        : [{ id: contextId, applicationId: appId }, ...fresh];
      setContexts(merged);
      setSelectedCtxId(contextId);
      // Don't auto-advance — user clicks "Use" to activate and proceed
    } catch (e) { setErr(String(e)); } finally { setCreating(false); }
  }

  async function selectCtx(ctx: ContextRecord) {
    try {
      const identities = await getContextIdentities(ctx.id);
      setContextId(ctx.id);
      if (identities[0]) setContextIdentity(identities[0]);
      setSelectedCtxId(ctx.id);
    } catch (e) { setErr(String(e)); }
  }

  return (
    <>
      <Intro>
        A context is the running instance of your WASM app. Both nodes will share the same context ID.
        Create one or select an existing context on this node.
      </Intro>

      {loading ? <p style={{ color: C.muted, fontSize: 13 }}>Loading…</p> : contexts.length > 0 ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.surface }}>
                {["Context ID", "App ID", ""].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase" as const, textAlign: "left", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contexts.map((ctx, i) => (
                <tr key={ctx.id} style={{ borderBottom: i < contexts.length - 1 ? `1px solid ${C.border}` : "none", background: ctx.id === selectedCtxId ? C.brand + "10" : "transparent" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <code style={{ fontSize: 11 }}>{ctx.id.slice(0, 24)}…</code>
                      {ctx.id === selectedCtxId && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 10, background: C.brand + "22", color: C.brand, border: `1px solid ${C.brand}55`, whiteSpace: "nowrap" as const }}>selected</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: C.muted }}><code style={{ fontSize: 11 }}>{ctx.applicationId.slice(0, 16)}…</code></td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {confirmDeleteId === ctx.id ? (
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: C.warning }}>Delete?</span>
                        <button style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: C.warning, border: "none", color: "#000", cursor: "pointer", fontWeight: 600 }} onClick={() => removeCtx(ctx.id)} disabled={deleting}>{deleting ? "…" : "Yes"}</button>
                        <button style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer" }} onClick={() => setConfirmDeleteId(null)}>No</button>
                      </span>
                    ) : (
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button className={ctx.id === selectedCtxId ? "btn-calimero-outline" : "btn-calimero"} style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => selectCtx(ctx)}>
                          {ctx.id === selectedCtxId ? "Active ✓" : "Use"}
                        </button>
                        <button style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "none", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer" }} onClick={() => setConfirmDeleteId(ctx.id)}>🗑</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 10 }}>Create new context</div>
        <button className="btn-calimero" onClick={create} disabled={creating}>{creating ? "Creating…" : "Create New Context"}</button>
      </div>

      {err && <Err>{err}</Err>}

      {selectedCtxId && (
        <>
          <CopyBox value={selectedCtxId} label="Selected Context ID" />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button className="btn-calimero" onClick={() => onDone(selectedCtxId)}>
              Continue to Step 4 →
            </button>
          </div>
        </>
      )}
    </>
  );
}

function OwnerStep3Invite({
  namespaceId, onDone,
}: { namespaceId: string; onDone: () => void }) {
  const [nsId, setNsId] = useState(namespaceId);
  const [invObj, setInvObj] = useState<object | null>(null);
  const [tab, setTab] = useState<"JSON" | "Compact">("Compact");
  const [copiedTab, setCopiedTab] = useState<"JSON" | "Compact" | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (namespaceId) setNsId(namespaceId); }, [namespaceId]);

  async function generate() {
    if (!nsId.trim()) return;
    setLoading(true); setErr(null); setInvObj(null);
    try {
      const inv = await createNamespaceInvitation(nsId.trim());
      setInvObj(inv as object);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }

  function copyAs(format: "JSON" | "Compact") {
    if (!invObj) return;
    const text = format === "JSON" ? compactJson(invObj) : invToCompact(invObj);
    navigator.clipboard.writeText(text).then(() => {
      setCopiedTab(format);
      onDone();
      setTimeout(() => setCopiedTab(null), 1500);
    });
  }

  const b58 = invObj ? invToCompact(invObj) : "";

  return (
    <>
      <Intro>
        Generate a signed invitation token that authorizes Node B to join this namespace.
        Share it via the Setup Wizard on Node B (Joiner mode → Step 1).
        Each invitation is single-use — regenerate if Node B needs to rejoin.
      </Intro>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <input className="form-control" style={{ flex: 1 }} value={nsId} onChange={(e) => setNsId(e.target.value)} placeholder="Namespace ID (hex)" />
        <FieldHelp text="The hex-encoded namespace ID from Step 1. This is the group that owns your context." />
        <button className="btn-calimero" onClick={generate} disabled={loading || !nsId.trim()}>{loading ? "Generating…" : "Generate Invitation"}</button>
      </div>

      {invObj && (
        <>
          <div style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 7, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.muted, lineHeight: 1.65 }}>
            <strong style={{ color: C.text }}>JSON vs Compact — same token, different packaging.</strong>{" "}
            The invitation is a signed cryptographic object. Both formats carry identical data — Compact is just the JSON bytes encoded as a compact string.
            It's purely aesthetic: Compact is easier to copy in one click and less likely to be mangled by chat apps or email.
            Node B's Setup Wizard accepts either format.
          </div>

          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding: "0 4px", background: C.card }}>
              <Tabs tabs={["Compact", "JSON"]} active={tab} onSelect={(t) => setTab(t as "JSON" | "Compact")} />
            </div>
            <div style={{ padding: "12px 14px", background: C.surface }}>
              {tab === "JSON" ? (
                <>
                  <pre style={{ margin: 0, fontSize: 11, color: C.text, fontFamily: "'Courier New', monospace", lineHeight: 1.6, whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const, maxHeight: 240, overflowY: "auto" as const }}>
                    {compactJson(invObj)}
                  </pre>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <button type="button" onClick={() => copyAs("JSON")} style={{ background: C.brand, border: "none", borderRadius: 4, color: "#000", fontSize: 11, padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}>
                      {copiedTab === "JSON" ? "Copied ✓" : "Copy JSON"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <code style={{ display: "block", fontSize: 11, color: C.brand, wordBreak: "break-all" as const, lineHeight: 1.7 }}>{b58}</code>
                  <p style={{ margin: "8px 0 0", fontSize: 11, color: C.muted }}>Compact-encoded — one string, no braces, no whitespace.</p>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <button type="button" onClick={() => copyAs("Compact")} style={{ background: C.brand, border: "none", borderRadius: 4, color: "#000", fontSize: 11, padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}>
                      {copiedTab === "Compact" ? "Copied ✓" : "Copy Compact"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
              On Node B: Joiner mode → Step 1 → paste either format.
            </p>
            <button type="button" onClick={() => { setInvObj(null); onDone(); }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>
              Done
            </button>
          </div>
        </>
      )}
      {err && <Err>{err}</Err>}
    </>
  );
}

// ─── JOINER FLOW (Node B) ─────────────────────────────────────────────────────

function JoinerStep1Namespace({ onDone }: { onDone: (nsId: string) => void }) {
  const [nsId, setNsId] = useState("");
  const [invInput, setInvInput] = useState("");
  const [tab, setTab] = useState<"Compact" | "JSON">("Compact");
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function parseInvitation(raw: string): object {
    const s = raw.trim();
    if (s.startsWith("{")) return JSON.parse(s);
    return compactToInv(s);
  }

  async function join() {
    if (!nsId.trim() || !invInput.trim()) return;
    setLoading(true); setErr(null); setOk(false);
    try {
      const invObj = parseInvitation(invInput);
      await joinNamespace(nsId.trim(), invObj);
      setOk(true);
      onDone(nsId.trim());
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }

  const canJoin = !!nsId.trim() && !!invInput.trim();

  return (
    <>
      <Intro>
        Node A (the owner) generated an invitation. Enter the namespace ID and paste the invitation — either format works.
      </Intro>

      <div style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 7, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.muted, lineHeight: 1.65 }}>
        <strong style={{ color: C.text }}>Compact or JSON — your choice.</strong>{" "}
        Both carry the same signed token. Compact is a single compact string; JSON is the raw object.
        Switch tabs to match what Node A sent you — the result is identical.
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <Label>Namespace ID</Label>
          <FieldHelp text="The hex-encoded namespace ID from Node A's Setup Wizard Step 1. It's a 64-character hex string." />
        </div>
        <input className="form-control" value={nsId} onChange={(e) => setNsId(e.target.value)} placeholder="Namespace ID (hex, 64 chars)" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Invitation from Node A</Label>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "0 4px", background: C.card }}>
            <Tabs tabs={["Compact", "JSON"]} active={tab} onSelect={(t) => { setTab(t as "Compact" | "JSON"); setInvInput(""); }} />
          </div>
          <div style={{ padding: "12px 14px", background: C.surface }}>
            {tab === "Compact" ? (
              <>
                <input
                  className="form-control"
                  value={invInput}
                  onChange={(e) => setInvInput(e.target.value)}
                  placeholder="Paste Compact invitation string from Node A…"
                  style={{ fontFamily: "'Courier New', monospace", fontSize: 11 }}
                />
                <p style={{ margin: "6px 0 0", fontSize: 11, color: C.muted }}>A single compact string — no braces, no spaces.</p>
              </>
            ) : (
              <>
                <textarea
                  className="form-control"
                  value={invInput}
                  onChange={(e) => setInvInput(e.target.value)}
                  rows={6}
                  placeholder='Paste the full invitation JSON from Node A…'
                  style={{ width: "100%", boxSizing: "border-box" as const, fontFamily: "'Courier New', monospace", fontSize: 11, resize: "vertical" as const }}
                />
                <p style={{ margin: "6px 0 0", fontSize: 11, color: C.muted }}>Paste the full JSON object including the outer braces.</p>
              </>
            )}
          </div>
        </div>
      </div>

      <button className="btn-calimero" onClick={join} disabled={loading || !canJoin}>{loading ? "Joining…" : "Join Namespace"}</button>
      {ok && <OK>Successfully joined the namespace. Now join the context in Step 2.</OK>}
      {err && <Err>{err}</Err>}
    </>
  );
}

function JoinerStep2Context({ onDone }: { onDone: (ctxId: string) => void }) {
  const [ctxId, setCtxId] = useState("");
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function join() {
    if (!ctxId.trim()) return;
    setLoading(true); setErr(null); setOk(false);
    try {
      await joinContextById(ctxId.trim());
      const identities = await getContextIdentities(ctxId.trim());
      setContextId(ctxId.trim());
      if (identities[0]) setContextIdentity(identities[0]);
      setOk(true);
      onDone(ctxId.trim());
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }

  return (
    <>
      <Intro>
        After joining the namespace, join the specific context. The context ID was shared by Node A.
      </Intro>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <Label>Context ID</Label>
          <FieldHelp text="The base58-encoded context ID from Node A's Step 2. Both nodes must join the same context ID to share CRDT state." />
        </div>
        <input className="form-control" value={ctxId} onChange={(e) => setCtxId(e.target.value)} placeholder="Context ID (base58)" />
      </div>

      <button className="btn-calimero" onClick={join} disabled={loading || !ctxId.trim()}>{loading ? "Joining…" : "Join Context"}</button>
      {ok && <OK>Joined and active. CRDT state will sync from Node A.</OK>}
      {err && <Err>{err}</Err>}
    </>
  );
}

// ─── Mode selector cards ──────────────────────────────────────────────────────

function ModeCard({
  mode, emoji, title, description, onClick,
}: {
  mode: "owner" | "joiner"; emoji: string; title: string;
  description: string; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const accentColor = mode === "owner" ? C.brand : "#3b82f6";
  const accentBg = mode === "owner" ? "rgba(165,255,17,0.08)" : "rgba(59,130,246,0.08)";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        flex: 1, padding: "22px 18px", borderRadius: 12, cursor: "pointer",
        background: hovered ? accentBg : C.card,
        border: `1.5px solid ${hovered || pressed ? accentColor : C.border}`,
        color: C.text, textAlign: "center" as const,
        display: "flex", flexDirection: "column" as const, gap: 10, alignItems: "center",
        transition: "background 0.15s, border-color 0.15s, transform 0.1s, box-shadow 0.15s",
        transform: pressed ? "scale(0.98)" : hovered ? "translateY(-2px)" : "none",
        boxShadow: hovered && !pressed ? `0 4px 20px ${accentColor}22` : "none",
        outline: "none",
      }}
    >
      <span style={{
        fontSize: 36,
        filter: hovered ? "none" : "grayscale(20%)",
        transition: "filter 0.15s",
      }}>{emoji}</span>
      <span style={{
        fontSize: 15, fontWeight: 700,
        color: hovered ? accentColor : C.text,
        transition: "color 0.15s",
      }}>{title}</span>
      <span style={{ fontSize: 12, fontWeight: 400, color: C.muted, lineHeight: 1.5, maxWidth: 220 }}>
        {description}
      </span>
      <span style={{
        marginTop: 4, fontSize: 11, fontWeight: 600,
        padding: "4px 12px", borderRadius: 20,
        background: hovered ? accentColor + "22" : "transparent",
        border: `1px solid ${hovered ? accentColor : C.border}`,
        color: hovered ? accentColor : C.muted,
        transition: "all 0.15s",
      }}>
        {hovered ? "Click to select →" : mode === "owner" ? "Node A" : "Node B"}
      </span>
    </button>
  );
}

function ModeSelector({ onSelect }: { onSelect: (m: "owner" | "joiner") => void }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <FlowDiagram />
      <div style={{ display: "flex", gap: 14 }}>
        <ModeCard
          mode="owner"
          emoji="🏗"
          title="I'm the Owner"
          description="Create namespace, context, and generate invitations for other nodes to join."
          onClick={() => onSelect("owner")}
        />
        <ModeCard
          mode="joiner"
          emoji="🔗"
          title="I'm Joining"
          description="Join an existing namespace and context using an invitation from Node A."
          onClick={() => onSelect("joiner")}
        />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SetupWizard() {
  const [mode, setMode] = useState<"owner" | "joiner" | null>(null);
  const [openStep, setOpenStep] = useState(1);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [nsId, setNsId] = useState("");
  const [appId, setAppId] = useState("");
  const [groupId, setGroupId] = useState("");

  function markDone(step: number) {
    setDone((p) => new Set([...p, step]));
    setOpenStep(step + 1);
  }
  function status(step: number): StepStatus {
    if (done.has(step)) return "done";
    if (openStep === step) return "active";
    return "pending";
  }
  function toggle(step: number) {
    setOpenStep((p) => (p === step ? 0 : step));
  }

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Setup Wizard</h2>
        <p className="section-desc">
          Set up a complete two-node Calimero environment from this UI. Pick your role to begin.
        </p>
      </div>

      {/* Privacy model callout */}
      <div style={{ background: "#0d1f12", border: "1px solid rgba(165,255,17,0.2)", borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: 13, lineHeight: 1.7, color: C.muted }}>
        <strong style={{ color: C.brand }}>How access works in Calimero:</strong>
        <div style={{ marginTop: 6 }}>
          All namespaces require an invitation — there are no public groups.
          Node A (the owner) creates a namespace and generates a signed invitation token.
          Node B pastes that token to join. Without a valid invitation, Node B cannot access any
          data in the context.
          Think of the invitation as a private key to the group.
        </div>
      </div>

      {/* Mode selector */}
      {!mode ? (
        <ModeSelector onSelect={(m) => { setMode(m); setOpenStep(1); setDone(new Set()); setNsId(""); setAppId(""); setGroupId(""); }} />
      ) : (
        <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
          <button
            onClick={() => { setMode(null); setOpenStep(1); setDone(new Set()); setNsId(""); setAppId(""); setGroupId(""); }}
            style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 12, padding: "4px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
          >
            ← Back
          </button>
          <span style={{ fontSize: 13, color: C.muted }}>
            Mode: <strong style={{ color: C.text }}>{mode === "owner" ? "Owner (Node A)" : "Joiner (Node B)"}</strong>
          </span>
        </div>
      )}

      {/* Owner flow */}
      {mode === "owner" && (
        <>
          <StepCard num={1} title="Namespace (root group)" status={status(1)} open={openStep === 1} onToggle={() => toggle(1)}>
            <OwnerStep1Namespace onDone={(id, aid) => { setNsId(id); setAppId(aid); markDone(1); }} />
          </StepCard>
          <StepCard num={2} title="Create Group" status={status(2)} open={openStep === 2} onToggle={() => toggle(2)}>
            <OwnerStep2Group key={nsId} namespaceId={nsId} onDone={(id) => { setGroupId(id); markDone(2); }} />
          </StepCard>
          <StepCard num={3} title="Create Context" status={status(3)} open={openStep === 3} onToggle={() => toggle(3)}>
            <OwnerStep2Context key={groupId} groupId={groupId} appId={appId} onDone={() => markDone(3)} />
          </StepCard>
          <StepCard num={4} title="Generate Namespace Invitation" status={status(4)} open={openStep === 4} onToggle={() => toggle(4)}>
            <OwnerStep3Invite namespaceId={nsId} onDone={() => markDone(4)} />
          </StepCard>
          <StepCard num={5} title="Initialize Workspace (optional)" status={status(5)} open={openStep === 5} onToggle={() => toggle(5)}>
            <StepWorkspace onDone={() => markDone(5)} />
          </StepCard>
        </>
      )}

      {/* Joiner flow */}
      {mode === "joiner" && (
        <>
          <StepCard num={1} title="Join Namespace" status={status(1)} open={openStep === 1} onToggle={() => toggle(1)}>
            <JoinerStep1Namespace onDone={(id) => { setNsId(id); markDone(1); }} />
          </StepCard>
          <StepCard num={2} title="Join Context" status={status(2)} open={openStep === 2} onToggle={() => toggle(2)}>
            <JoinerStep2Context onDone={() => markDone(2)} />
          </StepCard>
          <StepCard num={3} title="Initialize Workspace (optional)" status={status(3)} open={openStep === 3} onToggle={() => toggle(3)}>
            <StepWorkspace onDone={() => markDone(3)} />
          </StepCard>
        </>
      )}
    </div>
  );
}
