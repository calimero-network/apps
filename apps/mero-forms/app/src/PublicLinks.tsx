import { useState } from "react";
import { useMero } from "@calimero-apps/cloud";
import type { FormView, LinkView } from "./generated/FormsClient";
import {
  LINK_METHODS,
  createAccessGrant,
  revokeAccessGrant,
  sha256Hex,
  type OwnerNode,
} from "./lib/accessGrants";
import { NODE_VERIFIES_TURNSTILE, fetchCaptchaConfig } from "./lib/captcha";
import { ago } from "./lib/fields";
import { shortAccount } from "./lib/people";
import { publicLinkUrl } from "./lib/publicLink";
import { BASE } from "./route";
import { useRead, type Workspace } from "./useWorkspace";

/**
 * A form's public links: anyone with one answers the form in their browser,
 * signed in or not.
 *
 * Making a link is two things done together, as Mero Calendar's booking links
 * are: a core access grant on this teammate's node, naming only `link_form`
 * and `submit_via_link`, and a contract record keyed by the SHA-256 of the
 * grant's token. The visitor's browser calls this node with the token, so the
 * node must be reachable from the internet; an account session has no node of
 * its own and cannot make one.
 *
 * The form decides whether its links take responses (Public), how many each
 * may send per hour, and whether each response needs a captcha. The contract
 * enforces all three, so a visitor calling the node directly meets them too.
 */
export function PublicLinks({
  form,
  workspace,
  contextId,
}: {
  form: FormView;
  workspace: Workspace;
  contextId: string;
}) {
  const { mero, admin, nodeUrl, isDelegated } = useMero();
  const links = useRead(workspace.client, workspace.version, (c) => c.listLinks({ form_id: form.id }), [form.id]);
  const me = useRead(workspace.client, 0, (c) => c.myAccount(), []);
  const [label, setLabel] = useState("");
  const [cap, setCap] = useState(String(form.link_cap));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ label: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);

  const ownerNode: OwnerNode | null =
    !isDelegated && nodeUrl && mero && "getTokenData" in mero && admin
      ? {
          nodeUrl,
          token: () => mero.getTokenData()?.access_token ?? null,
          refresh: () => admin.getNodeIdentity(),
        }
      : null;

  async function run(what: string, f: () => Promise<unknown>) {
    setBusy(what);
    setError(null);
    setNotes(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const setPublic = (on: boolean) =>
    run("public", () => workspace.act((c) => c.setFormPublic({ form_id: form.id, public: on })));

  const saveCap = () =>
    run("cap", () => workspace.act((c) => c.setLinkCap({ form_id: form.id, per_hour: Number(cap) })));

  // The team's own Turnstile keys, when set, have the contract check the
  // token through the namespace's TEE; otherwise this deployment's verifier
  // signs a pass.
  const captchaSettings = useRead(workspace.client, workspace.version, (c) => c.captchaSettings(), []);
  const setCaptcha = (on: boolean) =>
    run("captcha", async () => {
      const key = !on
        ? ""
        : captchaSettings.data?.secret_set
          ? NODE_VERIFIES_TURNSTILE
          : (await fetchCaptchaConfig()).publicKey;
      await workspace.act((c) => c.setCaptchaKey({ form_id: form.id, key }));
    });

  const createLink = () =>
    run("create", async () => {
      if (!ownerNode) return;
      setMade(null);
      setCopied(false);
      const name = label.trim();
      const grant = await createAccessGrant(ownerNode, contextId, {
        methods: LINK_METHODS,
        label: name ? `Mero Forms link · ${name}` : "Mero Forms link",
      });
      try {
        const link = await sha256Hex(grant.token);
        await workspace.act((c) =>
          c.createLink({ form_id: form.id, link, grant_id: grant.grantId, label: name }),
        );
      } catch (e) {
        // No record, no link: take the grant back rather than leave a token
        // that reaches nothing the team can see.
        await revokeAccessGrant(ownerNode, contextId, grant.grantId).catch(() => undefined);
        throw e;
      }
      setMade({
        label: name || "Public link",
        url: publicLinkUrl(window.location.origin + BASE.slice(0, -1), { nodeUrl: ownerNode.nodeUrl, contextId, token: grant.token }),
      });
      setLabel("");
    });

  const deleteLink = (link: LinkView) =>
    run(`delete:${link.id}`, async () => {
      if (!window.confirm(`Delete "${link.label || "Public link"}"? Anyone who has it can no longer answer the form.`)) {
        return;
      }
      // The record first: without it the contract refuses the link at once,
      // wherever its grant lives.
      const gone = await workspace.act((c) => c.deleteLink({ link: link.id }));
      if (gone.created_by === me.data && ownerNode) {
        await revokeAccessGrant(ownerNode, contextId, gone.grant_id).catch(() => undefined);
      } else {
        setNotes(
          `The link no longer works. Its access grant stays on ${shortAccount(gone.created_by)}'s node, ` +
            "where it reaches nothing, until they remove it.",
        );
      }
    });

  async function copy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card" data-testid="public-links">
      <h2>Public links</h2>
      <p className="empty">
        Anyone with a link answers this form in their browser, without signing in. A link reaches
        this form and nothing else in the workspace: it can show the questions and send a response.
      </p>

      <div className="link-settings">
        <label className="switch">
          <input
            type="checkbox"
            aria-label="public"
            checked={form.public}
            disabled={busy !== null}
            onChange={(e) => void setPublic(e.target.checked)}
          />
          <span>
            <strong>Public:</strong> {form.public ? "links take responses" : "links are paused"}
          </span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            aria-label="require a captcha"
            checked={form.captcha_key !== ""}
            disabled={busy !== null}
            onChange={(e) => void setCaptcha(e.target.checked)}
          />
          <span>
            Require a captcha
            {form.captcha_key === NODE_VERIFIES_TURNSTILE && " (checked with your team's keys)"}
            {form.captcha_key !== "" &&
              form.captcha_key !== NODE_VERIFIES_TURNSTILE &&
              captchaSettings.data?.secret_set &&
              " (turn off and on to use your team's keys)"}
          </span>
        </label>
        <form
          className="row cap-row"
          onSubmit={(e) => {
            e.preventDefault();
            void saveCap();
          }}
        >
          <label className="switch">
            <span>At most</span>
            <input
              aria-label="responses per hour"
              className="cap-input"
              type="number"
              min={1}
              max={10000}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
            <span>responses per link per hour</span>
          </label>
          {cap !== String(form.link_cap) && (
            <button type="submit" className="ghost" disabled={busy !== null}>
              Save
            </button>
          )}
        </form>
      </div>

      {ownerNode ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void createLink();
          }}
        >
          <input
            aria-label="public link label"
            placeholder="Where you will share it (optional), e.g. newsletter"
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" disabled={busy !== null}>
            {busy === "create" ? "Making the link…" : "Create public link"}
          </button>
        </form>
      ) : (
        <p className="note">
          A link is served by the node that makes it, so visitors&apos; browsers call that node.
          Sign in with a node (Calimero Desktop, a Calimero Cloud node or your own{" "}
          <code>merod</code>) that is reachable from the internet to make one.
        </p>
      )}
      {ownerNode && (
        <p className="note">
          Visitors&apos; browsers call this node at <code>{ownerNode.nodeUrl}</code>, so it must be
          reachable there from the internet and allow this app&apos;s origin.
        </p>
      )}
      {error && <pre className="err">{error}</pre>}
      {notes && <p className="note">{notes}</p>}

      {made && (
        <div className="issued" data-testid="issued-link">
          <h3>{made.label}</h3>
          <p>
            <strong>Shown once.</strong> If it is lost, delete it below and make another.
          </p>
          <pre className="env mono link-out">{made.url}</pre>
          <div className="row">
            <button onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
            <button className="ghost" onClick={() => window.open(made.url, "_blank", "noopener")}>
              Open
            </button>
            <button className="ghost" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {links.error && <pre className="err">{links.error}</pre>}
      {links.data && links.data.length > 0 && (
        <ul className="key-list">
          {links.data.map((l) => (
            <li key={l.id} className="key-row link-row">
              <div>
                <div className="key-label">{l.label || "Public link"}</div>
                <div className="meta">
                  {l.responses} {l.responses === 1 ? "response" : "responses"}
                  {l.last_hour > 0 ? ` (${l.last_hour} in the last hour)` : ""}
                  {l.last_response_at ? ` · last ${ago(l.last_response_at)}` : " · none yet"} · made{" "}
                  {ago(l.created_at)} on{" "}
                  <span className="mono" title={l.created_by}>
                    {l.created_by === me.data ? "this node" : `${shortAccount(l.created_by)}'s node`}
                  </span>
                </div>
              </div>
              <button
                className="ghost danger-text"
                disabled={busy !== null}
                onClick={() => void deleteLink(l)}
              >
                {busy === `delete:${l.id}` ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
