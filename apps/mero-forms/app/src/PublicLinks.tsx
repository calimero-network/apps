import { useState } from "react";
import type { FormView, LinkView } from "./formsApi";
import { fetchCaptchaConfig } from "./lib/captcha";
import { ago } from "./lib/fields";
import { revokeKey } from "./lib/formKey";
import { shortAccount } from "./lib/people";
import { LINK_METHODS, publicLinkUrl, sha256Hex } from "./lib/publicLink";
import { BASE } from "./route";
import { useSignedIn } from "./sessionContext";
import { useRead, type Workspace } from "./useWorkspace";

/**
 * A form's public links: anyone with one answers the form in their browser,
 * signed in or not.
 *
 * Making a link is two things done together, as Mero Calendar's booking links
 * are: a core API key of this teammate's account, limited to this workspace
 * and to `linkForm` and `submitViaLink` (a passkey step-up), and a contract
 * record keyed by the SHA-256 of the key. The visitor's browser calls the
 * cluster with the key, so there is no node of the teammate's that has to be
 * reachable.
 *
 * The form decides whether its links take responses (Public), how many each
 * may send per hour, and whether each response needs a captcha. The contract
 * enforces all three, so a visitor calling the cluster directly meets them too.
 */
export function PublicLinks({
  form,
  workspace,
  appId,
}: {
  form: FormView;
  workspace: Workspace;
  appId: string;
}) {
  const { client, passkey, after } = useSignedIn();
  const links = useRead(workspace.client, workspace.version, (c) => c.listLinks({ form_id: form.id }), [form.id]);
  const me = useRead(workspace.client, 0, (c) => c.myAccount(), []);
  const [label, setLabel] = useState("");
  const [cap, setCap] = useState(String(form.link_cap));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ label: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);

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

  // The captcha is a pass this deployment's verifier signs: the form saves
  // the verifier's public key. (v1 could also have the contract check the
  // token itself with the team's keys; this Calimero release cannot.)
  const setCaptcha = (on: boolean) =>
    run("captcha", async () => {
      const key = on ? (await fetchCaptchaConfig()).publicKey : "";
      await workspace.act((c) => c.setCaptchaKey({ form_id: form.id, key }));
    });

  const createLink = () =>
    run("create", async () => {
      setMade(null);
      setCopied(false);
      const name = label.trim();
      const key = await client.createApiKey(
        {
          label: (name ? `Mero Forms link · ${name}` : "Mero Forms link").slice(0, 128),
          apps: [appId],
          methods: [...LINK_METHODS],
        },
        passkey(),
      );
      after();
      try {
        const link = await sha256Hex(key.key);
        await workspace.act((c) => c.createLink({ form_id: form.id, link, grant_id: key.keyId, label: name }));
      } catch (e) {
        // No record, no link: take the key back rather than leave one that
        // reaches nothing the team can see.
        await revokeKey(client, key.keyId).catch(() => undefined);
        throw e;
      }
      setMade({
        label: name || "Public link",
        url: publicLinkUrl(window.location.origin + BASE.slice(0, -1), { app: appId, token: key.key }),
      });
      setLabel("");
    });

  const deleteLink = (link: LinkView) =>
    run(`delete:${link.id}`, async () => {
      if (!window.confirm(`Delete "${link.label || "Public link"}"? Anyone who has it can no longer answer the form.`)) {
        return;
      }
      // The record first: without it the contract refuses the link at once.
      const gone = await workspace.act((c) => c.deleteLink({ link: link.id }));
      if (gone.created_by === me.data) {
        await revokeKey(client, gone.grant_id).catch(() => undefined);
        after();
      } else {
        setNotes(
          `The link no longer works. Its API key stays on ${shortAccount(gone.created_by)}'s account, ` +
            "where it reaches nothing, until they revoke it.",
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
          <span>Require a captcha</span>
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
      <p className="note">
        A link is an API key of your account that reaches this form only. Making one asks for your
        passkey.
      </p>
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
                  {ago(l.created_at)} by{" "}
                  <span className="mono" title={l.created_by}>
                    {l.created_by === me.data ? "you" : shortAccount(l.created_by)}
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
