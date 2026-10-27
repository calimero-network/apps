import { useEffect, useState } from "react";
import { useMero, type CloudMero } from "@calimero-apps/cloud";
import type { FormView } from "./generated/FormsClient";
import { CrmSettings } from "./CrmSettings";
import { PublicLinks } from "./PublicLinks";
import { examplePayload } from "./lib/fields";
import { envBlock, issueFormKey, listFormKeys, revokeFormKey, type FormKey } from "./lib/formKey";
import type { Workspace } from "./useWorkspace";

/** The env block for a key just made: shown once, then gone with the page. */
interface Issued {
  label: string;
  env: string;
}


/**
 * Where a form's responses come from and go to: the website keys that may
 * answer it, and the Mero CRM pipeline they are sent on to.
 *
 * A website form key is an API key on the cluster that may call
 * `submit_response` on this workspace's app and nothing else: it cannot read
 * responses or change any form. See `lib/formKey.ts`.
 */
export function FormConnect({
  form,
  workspace,
  contextId,
  namespaceId,
  isAdmin,
}: {
  form: FormView;
  workspace: Workspace;
  contextId: string;
  namespaceId: string | null;
  isAdmin: boolean;
}) {
  return (
    <>
      <PublicLinks form={form} workspace={workspace} contextId={contextId} />
      {isAdmin ? (
        <FormKeys form={form} workspace={workspace} contextId={contextId} namespaceId={namespaceId} />
      ) : (
        <section className="card">
          <h2>Connect a website</h2>
          <p className="empty">An admin issues the keys a website answers this form with.</p>
        </section>
      )}
      <CrmSettings form={form} workspace={workspace} />
    </>
  );
}

export function FormKeys({
  form,
  contextId,
}: {
  form: FormView;
  workspace: Workspace;
  contextId: string;
  namespaceId: string | null;
}) {
  const { mero, nodeUrl } = useMero();
  const cloud = mero as unknown as CloudMero | null;
  const [keys, setKeys] = useState<FormKey[] | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [showPayload, setShowPayload] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (!cloud) return;
    let live = true;
    listFormKeys(cloud)
      .then((all) => live && setKeys(all.filter((k) => k.formId === form.id)))
      .catch((e: unknown) => live && setKeysError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [cloud, form.id, tick]);

  async function issue() {
    if (!cloud || !label.trim()) return;
    setError(null);
    setIssued(null);
    setCopied(false);
    setBusy(true);
    try {
      const key = await issueFormKey(cloud, contextId, form.id, label.trim());
      setIssued({ label: key.label, env: envBlock(nodeUrl ?? cloud.baseUrl, contextId, key) });
      setLabel("");
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: FormKey) {
    if (!cloud) return;
    if (!window.confirm(`Revoke "${key.label}"? The website using it stops sending responses.`)) return;
    setRevoking(key.keyId);
    setError(null);
    try {
      await revokeFormKey(cloud, key.keyId);
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevoking(null);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.env);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Connect a website</h2>
        <p className="empty">
          A form key lets a website&apos;s backend answer this form, and nothing else: it cannot
          read responses or change any form. The site sends each response straight to the
          Calimero Cloud cluster, so there is no server of yours in between. Responses it
          sends are recorded as yours, the admin who issued it.
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void issue();
          }}
        >
          <input
            aria-label="form key label"
            placeholder="Which website, e.g. calimero.network contact page"
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" disabled={!label.trim() || busy || !cloud}>
            {busy ? "Making the key…" : "Create form key"}
          </button>
        </form>
        {error && <pre className="err">{error}</pre>}

        {issued && (
          <div className="issued" data-testid="issued-key">
            <h3>{issued.label}</h3>
            <p>
              Add these to the website backend&apos;s environment (for calimero.network: the
              Vercel project&apos;s Production variables, marked sensitive). <strong>They are
              shown once.</strong> If they are lost, revoke this key and make another.
            </p>
            <pre className="env mono">{issued.env}</pre>
            <div className="row">
              <button onClick={copy}>{copied ? "Copied" : "Copy all"}</button>
              <button className="ghost" onClick={() => setIssued(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Keys for this form</h2>
        {keysError && <pre className="err">{keysError}</pre>}
        {keys && keys.length === 0 && <p className="empty">No form keys yet.</p>}
        {keys && keys.length > 0 && (
          <ul className="key-list">
            {keys.map((k) => (
              <li key={k.keyId} className="key-row">
                <div>
                  <div className="key-label">{k.label}</div>
                  <div className="meta">
                    <span className="mono" title={k.keyId}>
                      {k.keyId}
                    </span>
                  </div>
                </div>
                <button
                  className="ghost danger-text"
                  disabled={revoking === k.keyId}
                  onClick={() => void revoke(k)}
                >
                  {revoking === k.keyId ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>What the website sends</h2>
        <p className="empty">
          The backend signs a warrant for <code>submit_response</code> with these arguments: one
          answer per question, by the question&apos;s id. A choice is one of its options, checkboxes
          any of them.
        </p>
        <button className="ghost" onClick={() => setShowPayload((v) => !v)}>
          {showPayload ? "Hide example" : "Show example"}
        </button>
        {showPayload && <pre className="env mono" data-testid="payload-example">{examplePayload(form)}</pre>}
      </section>
    </>
  );
}
