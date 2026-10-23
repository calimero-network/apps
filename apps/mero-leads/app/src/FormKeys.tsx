import { useEffect, useState } from "react";
import { bootstrapFromInvitation } from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";
import type { FormKeyView } from "./generated/LeadsClient";
import { envBlock, mintFormIdentity } from "./lib/formKey";
import { ago } from "./lib/pipeline";
import { shortAccount } from "./lib/people";
import { useRead, type Inbox } from "./useInbox";

/** The env block for a key just made: shown once, then gone with the page. */
interface Issued {
  label: string;
  env: string;
}

type Step = "minting" | "inviting" | "joining" | "registering";

const STEP_TEXT: Record<Step, string> = {
  minting: "Making the key…",
  inviting: "Creating its invitation…",
  joining: "Adding it to the namespace…",
  registering: "Registering it…",
};

/**
 * Website form keys: issue one for a site's backend, see what each has sent,
 * revoke one.
 *
 * Issuing a key is four steps, all from this tab and this admin's session:
 *
 * 1. mint an account and a certified device (`mintFormIdentity`) — in this
 *    tab, so the secret exists nowhere until the admin copies it;
 * 2. have this node create an invitation to the namespace;
 * 3. present the new account's signed join to this same node, which makes it
 *    a plain Member (`bootstrapFromInvitation`);
 * 4. register it in the contract, which labels it and keeps it off the team.
 *
 * The key then writes the way any keyholder does on Calimero, by delegated
 * execution: the website signs a warrant for `submit_lead` and a relay runs it
 * as the key's account. It can submit and nothing else, because only the team
 * may read or change leads.
 */
/**
 * Whether THIS node can be the relay a form writes through.
 *
 * On Calimero Cloud the always-on namespace's fleet nodes relay by their TEE
 * role, and this does not apply. A node of the team's own relays only when an
 * admin grants it `CAN_AUTHOR_ON_BEHALF` on the namespace (not implied by
 * membership or by admin) and its operator runs it with `--delegated-access`,
 * which serves the warrant route without a node credential.
 */
function NodeRelay({ contextId, namespaceId }: { contextId: string; namespaceId: string | null }) {
  const { admin, nodeUrl, isDelegated } = useMero();
  const [info, setInfo] = useState<{ account: string; can: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!admin || isDelegated) return;
    let live = true;
    admin
      .getIntentRelay(contextId)
      .then((r) => live && setInfo({ account: r.executorAccount, can: r.canAuthorOnBehalf }))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [admin, isDelegated, contextId, tick]);

  // An account session has no node of its own to offer.
  if (isDelegated || !info) return null;

  async function grant() {
    if (!admin || !namespaceId || !info) return;
    setBusy(true);
    setError(null);
    try {
      await admin.grantAuthorship(namespaceId, info.account);
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" data-testid="node-relay">
      <h2>Where leads are written</h2>
      <p className="empty">
        A website writes through a relay that serves this inbox&apos;s namespace. Make the
        namespace always-on in Calimero Desktop and Calimero Cloud&apos;s nodes do it. Or let
        this node do it, if the website can reach it.
      </p>
      {info.can ? (
        <p className="note">
          This node can write for form keys. For a website to reach it, its operator runs it
          with <code>--delegated-access</code>, and the site&apos;s <code>CALIMERO_RELAY_URL</code> is{" "}
          <code>{nodeUrl}</code> (or its public address).
        </p>
      ) : (
        <div className="row">
          <button className="ghost" disabled={busy || !namespaceId} onClick={() => void grant()}>
            {busy ? "Granting…" : "Let this node write for form keys"}
          </button>
        </div>
      )}
      {error && <pre className="err">{error}</pre>}
    </section>
  );
}

export function FormKeys({
  inbox,
  contextId,
  namespaceId,
}: {
  inbox: Inbox;
  contextId: string;
  namespaceId: string | null;
}) {
  const { admin, nodeUrl, isDelegated } = useMero();
  const keys = useRead(inbox.client, inbox.version, (c) => c.listFormKeys(), []);
  const [label, setLabel] = useState("");
  const [step, setStep] = useState<Step | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function issue() {
    if (!admin || !namespaceId || !label.trim()) return;
    setError(null);
    setIssued(null);
    setCopied(false);
    try {
      setStep("minting");
      const identity = await mintFormIdentity();

      setStep("inviting");
      const created = await admin.createNamespaceInvitation(namespaceId);
      const invitation = (created as { invitation?: unknown }).invitation;
      if (!invitation) throw new Error("the node returned no invitation for this namespace");

      setStep("joining");
      const joined = await bootstrapFromInvitation({
        namespaceId,
        invitation: invitation as Parameters<typeof bootstrapFromInvitation>[0]["invitation"],
        credential: {
          account: identity.account,
          credential: identity.credential,
          deviceSecret: identity.deviceSecret,
        },
        // This node admits it. An account session has no node of its own, so
        // Calimero Cloud names the admitter instead.
        nodeUrl: isDelegated ? undefined : (nodeUrl ?? undefined),
      });
      if (!joined.ok) throw new Error(`could not add the key to the namespace (${joined.step}): ${joined.reason}`);

      setStep("registering");
      await inbox.act((c) => c.registerFormKey({ account: identity.account, label: label.trim() }));

      setIssued({ label: label.trim(), env: envBlock(identity, contextId) });
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep(null);
    }
  }

  async function revoke(key: FormKeyView) {
    if (!admin || !namespaceId) return;
    if (!window.confirm(`Revoke "${key.label}"? The website using it stops sending leads.`)) return;
    setRevoking(key.account);
    setError(null);
    try {
      // Membership is what lets it write; the register is what names it.
      await admin.removeGroupMembers(namespaceId, { members: [key.account] });
      await inbox.act((c) => c.forgetFormKey({ account: key.account }));
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
        <h2>Connect a website form</h2>
        <p className="empty">
          A form key lets a website&apos;s backend add leads to this inbox, and nothing else: it
          cannot read, edit or delete them. The site signs each lead with it and a Calimero
          relay writes it here, so there is no server of yours in between.
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
            placeholder="Which form, e.g. calimero.network contact page"
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" disabled={!label.trim() || step !== null || !namespaceId || !admin}>
            {step ? STEP_TEXT[step] : "Create form key"}
          </button>
        </form>
        {!namespaceId && <p className="note">Resolving this inbox&apos;s namespace…</p>}
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
              The site also needs a relay that serves this namespace: make it always-on in
              Calimero Desktop (signed in to Calimero Cloud), or point the site&apos;s{" "}
              <code>CALIMERO_RELAY_URL</code> at a node that relays for it.
            </p>
          </div>
        )}
      </section>

      <NodeRelay contextId={contextId} namespaceId={namespaceId} />

      <section className="card">
        <h2>Form keys</h2>
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
                    · {k.leads} {k.leads === 1 ? "lead" : "leads"}
                    {k.last_lead_at ? ` · last ${ago(k.last_lead_at)}` : " · none yet"} · made{" "}
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
    </>
  );
}
