import { useState } from "react";
import type { FormKeyView, FormView } from "./formsApi";
import { CrmSettings } from "./CrmSettings";
import { PublicLinks } from "./PublicLinks";
import { ago, examplePayload } from "./lib/fields";
import { createFormKey, envBlock, revokeKey } from "./lib/formKey";
import { shortAccount } from "./lib/people";
import { useSignedIn } from "./sessionContext";
import { useRead, type Workspace } from "./useWorkspace";

/** The env block for a key just made: shown once, then gone with the page. */
interface Issued {
  label: string;
  env: string;
}

type Step = "minting" | "registering";

const STEP_TEXT: Record<Step, string> = {
  minting: "Approve with your passkey…",
  registering: "Registering it…",
};

/**
 * Where a form's responses come from and go to: the website keys that may
 * answer it, its public links, and the Mero CRM pipeline they are sent on to.
 *
 * Issuing a website key is two steps, from this admin's session:
 *
 * 1. create a core API key of the admin's account, limited to this workspace
 *    and to `submitResponse` and `getForm` (a passkey step-up);
 * 2. register it in the contract by its id, which binds it to this form,
 *    labels it and keeps it off the team.
 *
 * The website's backend then calls `submitResponse` with the key. It can
 * answer this one form and nothing else.
 */
export function FormConnect({
  form,
  workspace,
  appId,
  isAdmin,
}: {
  form: FormView;
  workspace: Workspace;
  appId: string;
  isAdmin: boolean;
}) {
  return (
    <>
      <PublicLinks form={form} workspace={workspace} appId={appId} />
      {isAdmin ? (
        <FormKeys form={form} workspace={workspace} appId={appId} />
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
  workspace,
  appId,
}: {
  form: FormView;
  workspace: Workspace;
  appId: string;
}) {
  const { client, passkey, after } = useSignedIn();
  const allKeys = useRead(workspace.client, workspace.version, (c) => c.listFormKeys(), []);
  const keys = { ...allKeys, data: allKeys.data?.filter((k) => k.form_id === form.id) ?? null };
  const [showPayload, setShowPayload] = useState(false);
  const [label, setLabel] = useState("");
  const [step, setStep] = useState<Step | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function issue() {
    if (!label.trim()) return;
    setError(null);
    setIssued(null);
    setCopied(false);
    const name = label.trim();
    try {
      setStep("minting");
      const key = await createFormKey(client, appId, name, passkey());
      after();
      setStep("registering");
      try {
        await workspace.act((c) => c.registerFormKey({ account: key.keyId, form_id: form.id, label: name }));
      } catch (e) {
        // No registration, no key: take it back rather than leave one that
        // could answer any form.
        await revokeKey(client, key.keyId, passkey()).catch(() => undefined);
        throw e;
      }
      setIssued({ label: name, env: envBlock(key, appId, form.id) });
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep(null);
      after();
    }
  }

  async function revoke(key: FormKeyView) {
    if (!window.confirm(`Revoke "${key.label}"? The website using it stops sending responses.`)) return;
    setRevoking(key.account);
    setError(null);
    try {
      // The API key is what lets it call; the register is what names it.
      await revokeKey(client, key.account, passkey());
      await workspace.act((c) => c.forgetFormKey({ account: key.account }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevoking(null);
      after();
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
          read responses or change any form. It is an API key of your account, limited to this
          workspace, approved with your passkey.
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
          <button type="submit" disabled={!label.trim() || step !== null}>
            {step ? STEP_TEXT[step] : "Create form key"}
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
            <p className="note">
              The backend makes a <code>CalimeroClient</code> from{" "}
              <code>@calimero-network/mero-js</code> for this cluster, calls{" "}
              <code>useApiKey(CALIMERO_API_KEY)</code>, and calls <code>submitResponse</code> on{" "}
              <code>CALIMERO_APP_ID</code>. A key lasts at most a year: make a new one before then.
            </p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Keys for this form</h2>
        {keys.error && <pre className="err">{keys.error}</pre>}
        {keys.data && keys.data.length === 0 && <p className="empty">No form keys yet.</p>}
        {keys.data && keys.data.length > 0 && (
          <ul className="key-list">
            {keys.data.map((k) => (
              <li key={k.account} className="key-row">
                <div>
                  <div className="key-label">{k.label}</div>
                  <div className="meta">
                    <span className="mono" title={k.account}>
                      {shortAccount(k.account)}
                    </span>{" "}
                    · {k.responses} {k.responses === 1 ? "response" : "responses"}
                    {k.last_response_at ? ` · last ${ago(k.last_response_at)}` : " · none yet"} · made{" "}
                    {ago(k.created_at)}
                  </div>
                </div>
                <button
                  className="ghost danger-text"
                  disabled={revoking === k.account}
                  onClick={() => void revoke(k)}
                >
                  {revoking === k.account ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>What the website sends</h2>
        <p className="empty">
          The backend calls <code>submitResponse</code> with these arguments: one
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
