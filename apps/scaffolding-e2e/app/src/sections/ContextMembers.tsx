import { useState } from "react";
import * as api from "../api/kvStore";

function ResultBox({ result }: { result: unknown }) {
  if (result === undefined) return null;
  const isError =
    result !== null &&
    typeof result === "object" &&
    "error" in result &&
    (result as { error: unknown }).error !== null;
  return (
    <pre className={`result-box${isError ? " error" : ""}`}>
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

function useCall() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  async function run(fn: () => Promise<unknown>) {
    setLoading(true);
    try {
      setResult(await fn());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }
  return { loading, result, run };
}

const ROLES = ["admin", "member", "read-only"];

export function ContextMembers() {
  const [getRoleIdentity, setGetRoleIdentity] = useState("");
  const [setRoleIdentity, setSetRoleIdentity] = useState("");
  const [setRoleValue, setSetRoleValue] = useState("member");

  const listCall = useCall();
  const myRoleCall = useCall();
  const getRoleCall = useCall();
  const setRoleCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Context Members</h2>
        <p className="section-desc">
          Workspace-level membership and role management. Members are tracked
          inside the app with roles: <code>admin</code>, <code>member</code>,{" "}
          <code>read-only</code>.
        </p>
      </div>

      <div
        style={{
          background: "rgba(165,255,17,0.05)",
          border: "1px solid rgba(165,255,17,0.15)",
          borderRadius: 10,
          padding: 16,
          marginBottom: 20,
          fontSize: 12,
          color: "var(--color-text-muted)",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "var(--color-brand-600)" }}>
          Two layers of membership
        </strong>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            <span
              style={{
                display: "inline-block",
                padding: "1px 8px",
                borderRadius: 4,
                background: "#3b82f622",
                color: "#60a5fa",
                border: "1px solid #3b82f644",
                fontWeight: 600,
                fontSize: 11,
                marginRight: 6,
              }}
            >
              Infrastructure (meroctl)
            </span>
            Controls who can <em>join</em> a context — handled via namespace
            invitations. A node that hasn't been invited cannot reach any app
            method.
          </div>
          <div>
            <span
              style={{
                display: "inline-block",
                padding: "1px 8px",
                borderRadius: 4,
                background: "#a5ff1122",
                color: "var(--color-brand-600)",
                border: "1px solid rgba(165,255,17,0.3)",
                fontWeight: 600,
                fontSize: 11,
                marginRight: 6,
              }}
            >
              App level (these methods)
            </span>
            Fine-grained roles implemented inside the WASM app. The admin is
            set automatically on <code>ws_init</code>.
          </div>
        </div>
      </div>

      <div className="method-grid">
        {/* ws_list_members */}
        <div className="method-card">
          <div className="method-name">ws_list_members() → [MemberRecord]</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Returns all members with their roles:{" "}
            <code>{"{ identity, role }"}</code>.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={listCall.loading}
            onClick={() => listCall.run(() => api.wsListMembers())}
          >
            {listCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={listCall.result} />
        </div>

        {/* ws_my_role */}
        <div className="method-card">
          <div className="method-name">ws_my_role() → string</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Returns the role of the currently connected identity.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={myRoleCall.loading}
            onClick={() => myRoleCall.run(() => api.wsMyRole())}
          >
            {myRoleCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={myRoleCall.result} />
        </div>

        {/* ws_get_member_role */}
        <div className="method-card">
          <div className="method-name">ws_get_member_role(identity) → string</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Look up the role for a specific identity (base58 public key).
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="identity (base58)"
              value={getRoleIdentity}
              onChange={(e) => setGetRoleIdentity(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getRoleCall.loading}
            onClick={() =>
              getRoleCall.run(() => api.wsGetMemberRole(getRoleIdentity))
            }
          >
            {getRoleCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getRoleCall.result} />
        </div>

        {/* ws_set_member_role */}
        <div className="method-card">
          <div className="method-name">ws_set_member_role(identity, role)</div>
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            Assign a role to an identity. Only the admin can call this.
            Valid roles: <code>admin</code>, <code>member</code>,{" "}
            <code>read-only</code>.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="identity (base58)"
              value={setRoleIdentity}
              onChange={(e) => setSetRoleIdentity(e.target.value)}
            />
            <select
              className="form-control"
              value={setRoleValue}
              onChange={(e) => setSetRoleValue(e.target.value)}
              style={{ marginTop: 6 }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <button
            className="btn-calimero"
            disabled={setRoleCall.loading}
            onClick={() =>
              setRoleCall.run(() =>
                api.wsSetMemberRole(setRoleIdentity, setRoleValue),
              )
            }
          >
            {setRoleCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={setRoleCall.result} />
        </div>
      </div>
    </div>
  );
}
