import { useEffect, useState } from "react";
import { ResultBox } from "../components/ResultBox";
import { FieldHelp } from "../components/FieldHelp";
import * as api from "../api/kvStore";


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

function out<T>(res: unknown): T | null {
  return (res as { result?: { output?: T } })?.result?.output ?? null;
}

export function AccessControlSection() {
  const [roles, setRoles] = useState<string[]>([]);
  const [me, setMe] = useState<api.Identity | null>(null);

  const [grantRole, setGrantRole] = useState("");
  const [grantAccount, setGrantAccount] = useState("");
  const [revokeRole, setRevokeRole] = useState("");
  const [revokeAccount, setRevokeAccount] = useState("");
  const [membersRole, setMembersRole] = useState("");
  const [adminAccount, setAdminAccount] = useState("");
  const [revokeAdminAccount, setRevokeAdminAccount] = useState("");
  const [docValue, setDocValue] = useState("");
  const [ownedValue, setOwnedValue] = useState("");
  const [transferTo, setTransferTo] = useState("");

  const rolesCall = useCall();
  const grantCall = useCall();
  const revokeCall = useCall();
  const hasRoleCall = useCall();
  const membersCall = useCall();
  const myRolesCall = useCall();
  const adminsCall = useCall();
  const grantAdminCall = useCall();
  const revokeAdminCall = useCall();
  const projectCall = useCall();
  const capsCall = useCall();
  const docSetCall = useCall();
  const docGetCall = useCall();

  const ownerCall = useCall();
  const isOwnerCall = useCall();
  const ownedSetCall = useCall();
  const ownedGetCall = useCall();
  const transferCall = useCall();

  // The role vocabulary is the CONTRACT's, not a constant duplicated here —
  // `acl_grant` rejects a name it does not define, so hard-coding a list in the
  // UI is how you get a dropdown whose every option fails.
  useEffect(() => {
    api
      .aclRoles()
      .then((r) => setRoles(Object.keys(out<Record<string, string[]>>(r) ?? {})))
      .catch(() => {});
    api
      .whoami()
      .then((r) => setMe(out<api.Identity>(r)))
      .catch(() => {});
  }, []);

  const accountHelp =
    "An ACCOUNT id, not a device key. Both are 64 hex characters since core rc.27, so the shape will not warn you — only whoami (Identity, top of the sidebar) tells you which is which. Every authorization subject here is an account.";

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Access Control &amp; Ownership</h2>
        <p className="section-desc">
          <code>AccessControl</code> is a registry of <strong>named roles</strong>
          . <code>Ownable</code> is a single-writer cell with a real transfer.
          Neither is a flat writer set: this is the permission tier above
          Shared Storage.
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
          A grant is not in force until it is projected
        </strong>
        <br />
        Granting a role writes a registry entry and confers nothing on its own.
        The capability map that the merge check actually reads is{" "}
        <strong>projected</strong> from the registry by{" "}
        <code>acl_project</code>, as a separate signed action. So after any
        grant, revoke or admin change, run <code>acl_project</code> — and if a
        grant appears not to work, compare <code>acl_members_of</code> against{" "}
        <code>acl_capabilities</code> first. The window is always “not yet
        permitted”, never “wrongly permitted”.
        {me && (
          <>
            <br />
            <br />
            Your account: <code>{me.account_id}</code>
          </>
        )}
      </div>

      <h3 className="method-group-title">Roles</h3>
      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">acl_roles() → role → ops</div>
          <p className="method-hint">
            The roles this contract defines. `AccessControl` cannot enumerate
            role names itself — it stores only <code>role\0member</code> keys —
            so this list is app state.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={rolesCall.loading}
            onClick={() => rolesCall.run(() => api.aclRoles())}
          >
            {rolesCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={rolesCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_grant(role, account_hex)</div>
          <div className="method-inputs">
            <select
              className="form-control"
              value={grantRole}
              onChange={(e) => setGrantRole(e.target.value)}
            >
              <option value="">— role —</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <input
                className="form-control"
                placeholder="account (64 hex)"
                value={grantAccount}
                onChange={(e) => setGrantAccount(e.target.value)}
              />
              <FieldHelp text={accountHelp} />
            </div>
          </div>
          <button
            className="btn-calimero"
            disabled={grantCall.loading}
            onClick={() => grantCall.run(() => api.aclGrant(grantRole, grantAccount))}
          >
            {grantCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={grantCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_revoke(role, account_hex)</div>
          <p className="method-hint">
            Stores <code>false</code> rather than deleting, so membership stays a
            plain LWW boolean — re-granting after a revoke converges.
          </p>
          <div className="method-inputs">
            <select
              className="form-control"
              value={revokeRole}
              onChange={(e) => setRevokeRole(e.target.value)}
            >
              <option value="">— role —</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              className="form-control"
              placeholder="account (64 hex)"
              value={revokeAccount}
              onChange={(e) => setRevokeAccount(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={revokeCall.loading}
            onClick={() => revokeCall.run(() => api.aclRevoke(revokeRole, revokeAccount))}
          >
            {revokeCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={revokeCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_has_role(role, account_hex) → bool</div>
          <div className="method-inputs">
            <select
              className="form-control"
              value={membersRole}
              onChange={(e) => setMembersRole(e.target.value)}
            >
              <option value="">— role —</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              className="form-control"
              placeholder="account (64 hex)"
              value={grantAccount}
              onChange={(e) => setGrantAccount(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={hasRoleCall.loading}
            onClick={() => hasRoleCall.run(() => api.aclHasRole(membersRole, grantAccount))}
          >
            {hasRoleCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={hasRoleCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_members_of(role) → account[]</div>
          <div className="method-inputs">
            <select
              className="form-control"
              value={membersRole}
              onChange={(e) => setMembersRole(e.target.value)}
            >
              <option value="">— role —</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn-calimero-outline"
            disabled={membersCall.loading}
            onClick={() => membersCall.run(() => api.aclMembersOf(membersRole))}
          >
            {membersCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={membersCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_my_roles() → string[]</div>
          <p className="method-hint">Resolved by ACCOUNT, like every gate here.</p>
          <button
            className="btn-calimero-outline"
            disabled={myRolesCall.loading}
            onClick={() => myRolesCall.run(() => api.aclMyRoles())}
          >
            {myRolesCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={myRolesCall.result} />
        </div>
      </div>

      <h3 className="method-group-title">Admins — the writer set of the registry itself</h3>
      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">acl_admins() → account[]</div>
          <p className="method-hint">
            Admins <em>are</em> the registry's writer set, so “who may grant”
            needs no separate bookkeeping and cannot drift.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={adminsCall.loading}
            onClick={() => adminsCall.run(() => api.aclAdmins())}
          >
            {adminsCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={adminsCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_grant_admin(account_hex)</div>
          <p className="method-hint">
            <code>init</code> seeds exactly ONE admin — a deterministic
            multi-admin seed is not possible there — so a second admin always
            arrives through this authenticated rotation. This call{" "}
            <strong>projects for you</strong>: admin-ness lives on the registry,
            but projecting writes the document, so a new admin that had not been
            projected could never run the projection that grants it the mask.
          </p>
          <div className="method-inputs">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <input
                className="form-control"
                placeholder="account (64 hex)"
                value={adminAccount}
                onChange={(e) => setAdminAccount(e.target.value)}
              />
              <FieldHelp text={accountHelp} />
            </div>
          </div>
          <button
            className="btn-calimero"
            disabled={grantAdminCall.loading}
            onClick={() => grantAdminCall.run(() => api.aclGrantAdmin(adminAccount))}
          >
            {grantAdminCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={grantAdminCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_revoke_admin(account_hex)</div>
          <p className="method-hint">
            Revoking yourself is allowed and has no undo. Revoking the last admin
            is refused — the registry would be frozen for good. Also projects, so
            the revoked admin loses the document mask rather than keeping it.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="account (64 hex)"
              value={revokeAdminAccount}
              onChange={(e) => setRevokeAdminAccount(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={revokeAdminCall.loading}
            onClick={() => revokeAdminCall.run(() => api.aclRevokeAdmin(revokeAdminAccount))}
          >
            {revokeAdminCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={revokeAdminCall.result} />
        </div>
      </div>

      <h3 className="method-group-title">Projection — what merge actually reads</h3>
      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">acl_project() → accounts</div>
          <p className="method-hint">
            Pushes the registry onto the capability map. Admins are always given
            the full mask, so a projection can never lock them out.
          </p>
          <button
            className="btn-calimero"
            disabled={projectCall.loading}
            onClick={() => projectCall.run(() => api.aclProject())}
          >
            {projectCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={projectCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_capabilities() → account → ops</div>
          <p className="method-hint">
            Differs from <code>acl_members_of</code> exactly when a grant has not
            been projected yet.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={capsCall.loading}
            onClick={() => capsCall.run(() => api.aclCapabilities())}
          >
            {capsCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={capsCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_doc_set(value)</div>
          <p className="method-hint">Needs `write` in the projected map.</p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="value"
              value={docValue}
              onChange={(e) => setDocValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={docSetCall.loading}
            onClick={() => docSetCall.run(() => api.aclDocSet(docValue))}
          >
            {docSetCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={docSetCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">acl_doc_get() → string</div>
          <button
            className="btn-calimero-outline"
            disabled={docGetCall.loading}
            onClick={() => docGetCall.run(() => api.aclDocGet())}
          >
            {docGetCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={docGetCall.result} />
        </div>
      </div>

      <h3 className="method-group-title">Ownable — one writer, with a transfer</h3>
      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">owned_owner() → account | null</div>
          <p className="method-hint">
            <code>null</code> for a malformed multi-writer cell, rather than an
            arbitrary pick — so this can never report a non-deterministic owner.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={ownerCall.loading}
            onClick={() => ownerCall.run(() => api.ownedOwner())}
          >
            {ownerCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={ownerCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">owned_is_owner(account_hex) → bool</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="account (64 hex)"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={isOwnerCall.loading}
            onClick={() => isOwnerCall.run(() => api.ownedIsOwner(transferTo))}
          >
            {isOwnerCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={isOwnerCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">owned_set(value)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="value"
              value={ownedValue}
              onChange={(e) => setOwnedValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={ownedSetCall.loading}
            onClick={() => ownedSetCall.run(() => api.ownedSet(ownedValue))}
          >
            {ownedSetCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={ownedSetCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">owned_get() → string</div>
          <button
            className="btn-calimero-outline"
            disabled={ownedGetCall.loading}
            onClick={() => ownedGetCall.run(() => api.ownedGet())}
          >
            {ownedGetCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={ownedGetCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">owned_transfer(account_hex)</div>
          <p className="method-hint">
            One-way. After this you are no longer a writer, so there is no undo
            from your side.
          </p>
          <div className="method-inputs">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <input
                className="form-control"
                placeholder="new owner (64 hex)"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
              />
              <FieldHelp text={accountHelp} />
            </div>
          </div>
          <button
            className="btn-calimero-outline"
            disabled={transferCall.loading}
            onClick={() => transferCall.run(() => api.ownedTransfer(transferTo))}
          >
            {transferCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={transferCall.result} />
        </div>
      </div>
    </div>
  );
}
