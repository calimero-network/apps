import { useState, useEffect, useCallback } from "react";
import { getContextId, getContextIdentity } from "../lib/mero";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { SyncBar } from "../components/SyncBar";
import { FieldHelp } from "../components/FieldHelp";
import {
  listContexts, listNamespaces, listGroups, getAllContextIdentities,
  type ContextRecord as AdminContextRecord,
  type GroupRecord,
} from "../api/adminApi";
import { namespacesForThisApp } from "../api/appScope";
import {
  wsInit,
  wsGetInfo,
  wsRegisterChannel,
  wsUnregisterChannel,
  wsListChannels,
  wsRegisterGroup,
  wsUnregisterGroup,
  wsListGroups,
  wsSetMemberRole,
  wsListMembers,
  wsMyRole,
  wsPingChannel,
  wsPingCount,
  type WorkspaceInfo,
  type ChannelRecord,
  type WsGroupRecord,
  type MemberRecord,
} from "../api/kvStore";


function extractOutput<T>(res: unknown): T | null {
  const r = res as { result?: { output?: T } };
  return r?.result?.output ?? null;
}

function extractError(res: unknown): string | null {
  const r = res as { error?: { message?: string } };
  return r?.error?.message ?? null;
}


const C = {
  bg: "var(--color-bg-primary)",
  card: "var(--color-bg-card)",
  surface: "var(--color-bg-input)",
  border: "var(--color-border)",
  text: "var(--color-text-primary)",
  muted: "var(--color-text-muted)",
  brand: "var(--color-brand-600)",
};

function CardWrap({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="method-card"
      style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 16 }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: C.brand,
        fontFamily: "'Courier New', monospace",
        paddingBottom: 12,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: C.muted,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const color =
    role === "admin" ? "#A5FF11" : role === "member" ? "#60a5fa" : "#94a3b8";
  return (
    <span
      style={{
        background: color + "1a",
        color,
        border: `1px solid ${color}44`,
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 600,
        display: "inline-block",
      }}
    >
      {role}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "14px 16px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 700, color: C.brand }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function ClickId({ id, onUse, truncate = 20 }: { id: string; onUse?: (id: string) => void; truncate?: number }) {
  const [flash, setFlash] = useState<"copied" | "filled" | null>(null);

  function handle() {
    navigator.clipboard.writeText(id).catch(() => {});
    if (onUse) onUse(id);
    setFlash(onUse ? "filled" : "copied");
    setTimeout(() => setFlash(null), 1200);
  }

  return (
    <code
      title={`${id}\nClick to ${onUse ? "use + copy" : "copy"}`}
      onClick={handle}
      style={{
        fontSize: 10, cursor: "pointer", userSelect: "none",
        color: flash ? C.brand : undefined,
        opacity: flash ? 0.8 : 1,
        transition: "color 0.15s, opacity 0.15s",
        borderBottom: `1px dashed ${flash ? C.brand : C.border}`,
        paddingBottom: 1,
      }}
    >
      {flash === "filled" ? "✓ filled" : flash === "copied" ? "✓ copied" : `${id.slice(0, truncate)}…`}
    </code>
  );
}

function DarkTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.surface }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: "10px 14px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  textAlign: "left",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              style={{
                borderBottom:
                  i < rows.length - 1 ? `1px solid ${C.border}` : "none",
                background: i % 2 === 1 ? C.surface + "66" : "transparent",
              }}
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{ padding: "10px 14px", fontSize: 12, color: C.text }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// Dropdown that loads existing node IDs as options, with a "Enter manually" fallback
function IdPicker({
  placeholder,
  value,
  onChange,
  options,
  loading,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  loading?: boolean;
}) {
  const MANUAL = "__manual__";
  const isManual = options.length === 0 || !options.some((o) => o.value === value) && value !== "";
  const [mode, setMode] = useState<"select" | "manual">(isManual ? "manual" : "select");

  function handleSelect(v: string) {
    if (v === MANUAL) { setMode("manual"); onChange(""); }
    else { onChange(v); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {options.length > 0 && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => setMode("select")}
            style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer", border: "1px solid",
              background: mode === "select" ? "rgba(165,255,17,0.12)" : "transparent",
              color: mode === "select" ? C.brand : C.muted,
              borderColor: mode === "select" ? C.brand : C.border,
            }}
          >
            {loading ? "Loading…" : "From node"}
          </button>
          <button
            type="button"
            onClick={() => { setMode("manual"); onChange(""); }}
            style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer", border: "1px solid",
              background: mode === "manual" ? "rgba(165,255,17,0.12)" : "transparent",
              color: mode === "manual" ? C.brand : C.muted,
              borderColor: mode === "manual" ? C.brand : C.border,
            }}
          >
            Custom
          </button>
        </div>
      )}
      {mode === "select" ? (
        <select
          className="form-control"
          value={value}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">— select —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          <option value={MANUAL}>Enter manually…</option>
        </select>
      ) : (
        <input
          className="form-control"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function WsConcept() {
  return (
    <CardWrap>
      <CardTitle>How Workspace Manager Works</CardTitle>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[
          {
            icon: "🏢",
            title: "Namespace = The Company",
            body: "In Calimero rc.20, a namespace is tied to ONE application ID. All contexts created under it run the same WASM. This workspace context IS the namespace root — it's the main office directory that knows about every department (group) and every room (channel context).",
          },
          {
            icon: "📁",
            title: "Groups = Departments",
            body: 'A group owns a collection of contexts. Think "Engineering", "Marketing", "DMs". Create groups via meroctl, then register their IDs here so workspace members can discover them.',
          },
          {
            icon: "💬",
            title: "Channels = Context Rooms",
            body: "Each channel is another Calimero context. Create it with meroctl context create --group-id <ns>, then register its ID here. The workspace context acts as the directory: name → context ID.",
          },
          {
            icon: "🔗",
            title: "xcall = Cross-Context Ping",
            body: "ws_ping_channel fires env::xcall(target_ctx, \"ws_pong\", b\"{}\"). Fire-and-forget — queued by the node. The target executes ws_pong on the next proposal.",
          },
        ].map(({ icon, title, body }) => (
          <div
            key={title}
            style={{
              display: "flex",
              gap: 14,
              padding: 14,
              background: C.surface,
              borderRadius: 8,
              borderLeft: `3px solid ${C.brand}`,
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{title}</div>
              <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.6 }}>{body}</div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          background: "#0d1117",
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "14px 16px",
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          lineHeight: 1.8,
          color: C.muted,
        }}
      >
        <div style={{ color: C.brand, marginBottom: 6 }}># Full setup flow</div>
        <div>meroctl namespace create --name "Acme" --app-id &lt;APP_ID&gt;</div>
        <div>meroctl group create --namespace-id &lt;NS_ID&gt; --name "engineering"</div>
        <div>meroctl context create --group-id &lt;GROUP_ID&gt; --application-id &lt;APP_ID&gt;</div>
        <div style={{ marginTop: 8, color: "#60a5fa" }}># Then in this UI:</div>
        <div>1. ws_init "Acme Workspace"</div>
        <div>2. ws_register_group &lt;GROUP_ID&gt; "Engineering" "..."</div>
        <div>3. ws_register_channel &lt;CTX_ID&gt; "#general" "Announcements"</div>
        <div>4. ws_set_member_role &lt;IDENTITY&gt; "member"</div>
      </div>
    </CardWrap>
  );
}


function WsOverview({
  info,
  myRole,
  onRefresh,
}: {
  info: WorkspaceInfo | null;
  myRole: string | null;
  onRefresh: () => void;
}) {
  return (
    <CardWrap>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <CardTitle>Workspace Overview</CardTitle>
        <button className="btn-calimero-outline" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {info ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Stat label="Channels" value={info.channel_count} />
            <Stat label="Groups" value={info.group_count} />
            <Stat label="Members" value={info.member_count} />
          </div>

          <div className="result-box" style={{ fontSize: 12 }}>
            <div>
              <span style={{ color: C.muted }}>name: </span>
              <strong style={{ color: C.text }}>{info.name}</strong>
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={{ color: C.muted }}>admin: </span>
              <ClickId id={info.admin} truncate={32} />
            </div>
            {myRole && (
              <div style={{ marginTop: 6 }}>
                <span style={{ color: C.muted }}>your role: </span>
                <RoleBadge role={myRole} />
              </div>
            )}
          </div>
        </>
      ) : (
        <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>
          Workspace not initialized. Use <strong style={{ color: C.text }}>ws_init</strong> below.
        </p>
      )}
    </CardWrap>
  );
}


function WsInit({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");

  async function handleInit() {
    if (!name.trim()) return;
    setStatus("...");
    const res = await wsInit(name.trim());
    const err = extractError(res);
    if (err) {
      setStatus(`Error: ${err}`);
    } else {
      setStatus("Workspace initialized!");
      onDone();
    }
  }

  return (
    <CardWrap>
      <CardTitle>ws_init</CardTitle>
      <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>
        The caller becomes the workspace admin. Can only be called once.
      </p>
      <FieldGroup label="Workspace name">
        <div className="input-row">
          <input
            className="form-control"
            placeholder="e.g. Acme Corp"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInit()}
          />
          <button className="btn-calimero" onClick={handleInit}>
            Initialize
          </button>
        </div>
      </FieldGroup>
      {status && <div className="result-box">{status}</div>}
    </CardWrap>
  );
}


function WsChannels({ onRefresh }: { onRefresh: () => void }) {
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [ctxId, setCtxId] = useState("");
  const [chanName, setChanName] = useState("");
  const [topic, setTopic] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [pingId, setPingId] = useState("");
  const [status, setStatus] = useState("");
  const [ctxOptions, setCtxOptions] = useState<{ value: string; label: string }[]>([]);
  const [ctxLoading, setCtxLoading] = useState(false);

  async function load() {
    const res = await wsListChannels();
    setChannels(extractOutput<ChannelRecord[]>(res) ?? []);
  }

  useEffect(() => {
    load();
    setCtxLoading(true);
    listContexts()
      .then((list: AdminContextRecord[]) =>
        setCtxOptions(list.map((c) => ({
          value: c.id,
          label: `${c.id.slice(0, 20)}… (app: ${c.applicationId.slice(0, 8)}…)`,
        })))
      )
      .catch(() => {})
      .finally(() => setCtxLoading(false));
  }, []);

  async function handleRegister() {
    if (!ctxId.trim() || !chanName.trim()) return;
    setStatus("...");
    const res = await wsRegisterChannel(ctxId.trim(), chanName.trim(), topic.trim());
    const err = extractError(res);
    setStatus(err ? `Error: ${err}` : "Channel registered");
    load();
    onRefresh();
  }

  async function handleRemove() {
    if (!removeId.trim()) return;
    setStatus("...");
    const res = await wsUnregisterChannel(removeId.trim());
    const err = extractError(res);
    setStatus(err ? `Error: ${err}` : "Channel removed");
    load();
    onRefresh();
  }

  async function handlePing() {
    if (!pingId.trim()) return;
    setStatus("...");
    const res = await wsPingChannel(pingId.trim());
    const err = extractError(res);
    if (err) {
      setStatus(`Error: ${err}`);
      return;
    }
    // "Queued", not "delivered": `env::xcall` only enqueues, and whether the
    // node then dispatches or denies it is invisible to the caller. The count
    // read back here is THIS context's own pongs — it moves when someone pings
    // us, not when we ping them.
    const count = extractOutput<number>(await wsPingCount());
    setStatus(
      `Ping queued for ${pingId.trim()} — executes on the next proposal cycle. ` +
        `Pongs received by this context so far: ${count ?? 0}.`,
    );
  }

  return (
    <CardWrap>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <CardTitle>Channels (Contexts)</CardTitle>
        <button className="btn-calimero-outline" onClick={load}>Refresh</button>
      </div>

      <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>
        Each channel maps to another Calimero <strong style={{ color: C.text }}>context</strong>.
        The workspace acts as the directory: register a context ID here to make it discoverable.
      </p>

      {channels.length > 0 ? (
        <DarkTable
          headers={["Name", "Topic", "Context ID", "Created by"]}
          rows={channels.map((ch) => [
            <strong>{ch.name}</strong>,
            <span style={{ color: C.muted }}>{ch.topic || "—"}</span>,
            <ClickId id={ch.context_id} onUse={(id) => { setRemoveId(id); setPingId(id); }} />,
            <ClickId id={ch.created_by} truncate={12} />,
          ])}
        />
      ) : (
        <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>No channels registered yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FieldGroup label="Register a channel">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <div style={{ flex: 1 }}>
                <IdPicker
                  placeholder="Context ID (base58)"
                  value={ctxId}
                  onChange={setCtxId}
                  options={ctxOptions}
                  loading={ctxLoading}
                />
              </div>
              <FieldHelp text="A base58-encoded 32-byte identifier for a Calimero context. Create a context with meroctl context create or via the Setup Wizard, then paste its ID here." />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
              <input
                className="form-control"
                style={{ flex: "1 1 140px" }}
                placeholder="Name (e.g. #general)"
                value={chanName}
                onChange={(e) => setChanName(e.target.value)}
              />
              <input
                className="form-control"
                style={{ flex: "1 1 160px" }}
                placeholder="Topic (optional)"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
              <button className="btn-calimero" onClick={handleRegister}>Register</button>
            </div>
          </div>
        </FieldGroup>

        <FieldGroup label="Unregister a channel">
          <div className="input-row">
            <input
              className="form-control"
              placeholder="Context ID"
              value={removeId}
              onChange={(e) => setRemoveId(e.target.value)}
            />
            <button className="btn-calimero-outline" onClick={handleRemove}>Unregister</button>
          </div>
        </FieldGroup>

        <FieldGroup label="Cross-context ping (xcall)">
          <div className="input-row">
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <input
                className="form-control"
                style={{ flex: 1 }}
                placeholder="Target context ID (base58)"
                value={pingId}
                onChange={(e) => setPingId(e.target.value)}
              />
              <FieldHelp text="The context ID of the target context to ping. It must be running the same WASM (which has ws_pong). The xcall is fire-and-forget — it queues on the node and executes on the next proposal cycle." />
            </div>
            <button className="btn-calimero-outline" onClick={handlePing}>Ping</button>
          </div>
        </FieldGroup>
      </div>

      {status && <div className="result-box">{status}</div>}
    </CardWrap>
  );
}


function WsGroups({ onRefresh }: { onRefresh: () => void }) {
  const [groups, setGroups] = useState<WsGroupRecord[]>([]);
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [desc, setDesc] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [status, setStatus] = useState("");
  const [groupOptions, setGroupOptions] = useState<{ value: string; label: string }[]>([]);
  const [groupLoading, setGroupLoading] = useState(false);

  async function load() {
    const res = await wsListGroups();
    setGroups(extractOutput<WsGroupRecord[]>(res) ?? []);
  }

  useEffect(() => {
    load();
    setGroupLoading(true);
    listNamespaces()
      .then(async (allNs) => {
        // Only THIS application's namespaces. Node-wide otherwise, so the group
        // dropdown listed subgroups belonging to other apps' namespaces —
        // selectable, and guaranteed to fail once used.
        const ns = namespacesForThisApp(allNs);
        const all: GroupRecord[] = [];
        await Promise.all(ns.map(async (n) => {
          try {
            const gs = await listGroups(n.namespaceId);
            all.push(...gs);
          } catch { /* namespace may have no groups */ }
        }));
        setGroupOptions(all.map((g) => ({
          value: g.groupId,
          label: g.alias ? `${g.alias} (${g.groupId.slice(0, 12)}…)` : `${g.groupId.slice(0, 20)}…`,
        })));
      })
      .catch(() => {})
      .finally(() => setGroupLoading(false));
  }, []);

  async function handleRegister() {
    if (!groupId.trim() || !groupName.trim()) return;
    setStatus("...");
    const res = await wsRegisterGroup(groupId.trim(), groupName.trim(), desc.trim());
    const err = extractError(res);
    setStatus(err ? `Error: ${err}` : "Group registered");
    load();
    onRefresh();
  }

  async function handleRemove() {
    if (!removeId.trim()) return;
    setStatus("...");
    const res = await wsUnregisterGroup(removeId.trim());
    const err = extractError(res);
    setStatus(err ? `Error: ${err}` : "Group removed");
    load();
    onRefresh();
  }

  return (
    <CardWrap>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <CardTitle>Sub-Groups</CardTitle>
        <button className="btn-calimero-outline" onClick={load}>Refresh</button>
      </div>

      <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>
        Groups are Calimero <strong style={{ color: C.text }}>namespaces/groups</strong> that own
        a set of contexts. Register group IDs here so members know which groups exist in this workspace.
      </p>

      {groups.length > 0 ? (
        <DarkTable
          headers={["Name", "Description", "Group ID", "Created by"]}
          rows={groups.map((g) => [
            <strong>{g.name}</strong>,
            <span style={{ color: C.muted }}>{g.description || "—"}</span>,
            <ClickId id={g.group_id} onUse={setRemoveId} />,
            <ClickId id={g.created_by} truncate={12} />,
          ])}
        />
      ) : (
        <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>No groups registered yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FieldGroup label="Register a group">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <div style={{ flex: 1 }}>
                <IdPicker
                  placeholder="Group ID (hex)"
                  value={groupId}
                  onChange={setGroupId}
                  options={groupOptions}
                  loading={groupLoading}
                />
              </div>
              <FieldHelp text="The hex-encoded ID of a Calimero namespace group. Get it by running: meroctl group list --namespace-id <NS_ID>. Or create one via the Setup Wizard." />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
              <input
                className="form-control"
                style={{ flex: "1 1 140px" }}
                placeholder="Display name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
              <input
                className="form-control"
                style={{ flex: "1 1 200px" }}
                placeholder="Description (optional)"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
              <button className="btn-calimero" onClick={handleRegister}>Register</button>
            </div>
          </div>
        </FieldGroup>

        <FieldGroup label="Unregister a group">
          <div className="input-row">
            <input
              className="form-control"
              placeholder="Group ID"
              value={removeId}
              onChange={(e) => setRemoveId(e.target.value)}
            />
            <button className="btn-calimero-outline" onClick={handleRemove}>Unregister</button>
          </div>
        </FieldGroup>
      </div>

      {status && <div className="result-box">{status}</div>}
    </CardWrap>
  );
}


function WsMembers() {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [identity, setIdentity] = useState("");
  const [role, setRole] = useState("member");
  const [status, setStatus] = useState("");
  const [identityOptions, setIdentityOptions] = useState<{ value: string; label: string }[]>([]);

  async function load() {
    const res = await wsListMembers();
    setMembers(extractOutput<MemberRecord[]>(res) ?? []);
  }

  useEffect(() => {
    load();
    const ctxId = getContextId();
    const myKey = getContextIdentity();
    if (ctxId) {
      getAllContextIdentities(ctxId)
        .then((ids) => {
          const opts = ids.map((id) => ({
            value: id,
            label: id === myKey ? `${id.slice(0, 20)}… (me)` : `${id.slice(0, 20)}… (node B)`,
          }));
          setIdentityOptions(opts);
        })
        .catch(() => {});
    }
  }, []);

  async function handleSetRole() {
    if (!identity.trim()) return;
    setStatus("...");
    const res = await wsSetMemberRole(identity.trim(), role);
    const err = extractError(res);
    setStatus(err ? `Error: ${err}` : `Role set → ${role}`);
    load();
  }

  return (
    <CardWrap>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <CardTitle>Members &amp; Roles</CardTitle>
        <button className="btn-calimero-outline" onClick={load}>Refresh</button>
      </div>

      <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>
        App-level roles stored in CRDT state — independent of SDK-level membership.
        Roles: <strong style={{ color: C.text }}>admin</strong>,{" "}
        <strong style={{ color: C.text }}>member</strong>,{" "}
        <strong style={{ color: C.text }}>read-only</strong>.
      </p>
      <div style={{
        background: "rgba(165,255,17,0.05)", border: "1px solid rgba(165,255,17,0.2)",
        borderRadius: 6, padding: "10px 14px", fontSize: 12, color: C.muted, lineHeight: 1.6,
      }}>
        <strong style={{ color: C.brand }}>Why is Node B missing?</strong>{" "}
        Joining a context (SDK level) and having a workspace role (app level) are two separate things.
        On Node B, open this page and copy the executor identity from the top bar, then paste it here on Node A to assign a role.
        The dropdown below shows only identities that <em>this node</em> owns.
      </div>

      {members.length > 0 ? (
        <DarkTable
          headers={["Identity", "Role"]}
          rows={members.map((m) => [
            <ClickId id={m.identity} onUse={setIdentity} truncate={28} />,
            <RoleBadge role={m.role} />,
          ])}
        />
      ) : (
        <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>
          No members with explicit roles yet.
        </p>
      )}

      <FieldGroup label="Set role for identity">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <div style={{ flex: 1 }}>
              <IdPicker
                placeholder="Identity (base58 public key)"
                value={identity}
                onChange={setIdentity}
                options={identityOptions}
              />
            </div>
            <FieldHelp text="The Ed25519 public key of a context member, base58-encoded. Visible in the context bar after login, or run meroctl identity list on the member's node." />
          </div>
        <div className="input-row">
          <select
            className="form-control"
            style={{ width: 130, flex: "none" }}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="read-only">read-only</option>
          </select>
          <button className="btn-calimero" onClick={handleSetRole}>
            Set Role
          </button>
        </div>
        </div>
      </FieldGroup>

      {status && <div className="result-box">{status}</div>}
    </CardWrap>
  );
}


export function WorkspaceManager() {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await wsGetInfo();
    const out = extractOutput<WorkspaceInfo>(res);
    setInfo(out);
    if (out) {
      const roleRes = await wsMyRole();
      setMyRole(extractOutput<string>(roleRes));
    }
  }, []);

  const { pulse, sinceLabel } = useAutoRefresh(refresh, 5000);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Workspace Manager</h2>
        <p className="section-desc">
          This context acts as the namespace root — admin, groups, channels (contexts), and member roles.
        </p>
      </div>

      <WsConcept />
      <div style={{ marginBottom: 4 }}>
        <SyncBar pulse={pulse} sinceLabel={sinceLabel} onRefresh={refresh} />
      </div>
      <WsOverview info={info} myRole={myRole} onRefresh={refresh} />
      {!info && <WsInit onDone={refresh} />}
      <WsChannels onRefresh={refresh} />
      <WsGroups onRefresh={refresh} />
      <WsMembers />
    </div>
  );
}
