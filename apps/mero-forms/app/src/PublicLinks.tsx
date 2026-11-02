import { useEffect, useState } from "react";
import type { FormView, LinkView } from "./formsApi";
import { fetchCaptchaConfig } from "./lib/captcha";
import { ago } from "./lib/fields";
import { shortAccount } from "./lib/people";
import {
  newLinkToken,
  publicFormOrigin,
  publicLinkUrl,
  sha256Hex,
  toWorkspaceAccess,
  type WorkspaceAccess,
} from "./lib/publicLink";
import { BASE } from "./route";
import { useSignedIn } from "./sessionContext";
import { useRead, type Workspace } from "./useWorkspace";

/** How a form's links check a captcha: the contract's `captchaKey`. */
type CaptchaMode = "none" | "turnstile" | "verifier";

const captchaMode = (key: string): CaptchaMode => (key === "" ? "none" : key === "turnstile" ? "turnstile" : "verifier");


/**
 * A form's public links: anyone with one answers the form in their browser,
 * signed in or not.
 *
 * A link is a random token this browser makes; the contract records its
 * SHA-256 (`createLink`), and the token goes only into the link's URL. A
 * visitor's browser calls the workspace's two `#[app::public]` methods with
 * it, anonymously, which the cluster lets through once the workspace's owner
 * has opened it to public links (its access set to `public`).
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
  const { client, after } = useSignedIn();
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [accessTick, setAccessTick] = useState(0);
  useEffect(() => {
    let live = true;
    client
      .getApp(appId)
      .then((app) => live && setAccess(toWorkspaceAccess(app)))
      .catch(() => live && setAccess(null))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, appId, after, accessTick]);
  const links = useRead(workspace.client, workspace.version, (c) => c.listLinks({ form_id: form.id }), [form.id]);
  const me = useRead(workspace.client, 0, (c) => c.myAccount(), []);
  const [label, setLabel] = useState("");
  const [cap, setCap] = useState(String(form.link_cap));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ label: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(what: string, f: () => Promise<unknown>) {
    setBusy(what);
    setError(null);
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

  // `turnstile`: the contract checks the widget's token with Cloudflare from
  // the visitor's own call, with the secret the node's operator holds.
  // `verifier`: this deployment's verifier checks it and signs a pass; the
  // form saves the verifier's public key.
  const setCaptcha = (mode: CaptchaMode) =>
    run("captcha", async () => {
      const key = mode === "none" ? "" : mode === "turnstile" ? "turnstile" : (await fetchCaptchaConfig()).publicKey;
      await workspace.act((c) => c.setCaptchaKey({ form_id: form.id, key }));
    });

  // Only the workspace's owner may change who reaches it (the cluster's rule).
  const openToLinks = () =>
    run("access", async () => {
      if (
        !window.confirm(
          "Let anyone with a public link reach this workspace's form? Visitors reach only the two link " +
            "methods; every other method still checks that the caller is in your organization.",
        )
      ) {
        return;
      }
      try {
        await client.setAccess(appId, { kind: "public" });
      } finally {
        after();
      }
      setAccessTick((n) => n + 1);
    });

  const createLink = () =>
    run("create", async () => {
      setMade(null);
      setCopied(false);
      const name = label.trim();
      const token = newLinkToken();
      const link = await sha256Hex(token);
      await workspace.act((c) => c.createLink({ form_id: form.id, link, label: name }));
      const origin = publicFormOrigin(import.meta.env, window.location.origin + BASE.slice(0, -1));
      setMade({ label: name || "Public link", url: publicLinkUrl(origin, { app: appId, token }) });
      setLabel("");
    });

  const deleteLink = (link: LinkView) =>
    run(`delete:${link.id}`, async () => {
      if (!window.confirm(`Delete "${link.label || "Public link"}"? Anyone who has it can no longer answer the form.`)) {
        return;
      }
      // Without its record the contract refuses the link at once.
      await workspace.act((c) => c.deleteLink({ link: link.id }));
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
          <span>Captcha</span>
          <select
            aria-label="captcha"
            value={captchaMode(form.captcha_key)}
            disabled={busy !== null}
            onChange={(e) => void setCaptcha(e.target.value as CaptchaMode)}
          >
            <option value="none">None</option>
            <option value="turnstile">Cloudflare Turnstile, checked by the workspace</option>
            <option value="verifier">Cloudflare Turnstile, through this site&apos;s verifier</option>
          </select>
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
      {access && !access.public && (
        <div className="note" data-testid="links-closed">
          <p>
            Visitors who are not signed in cannot open links yet: this workspace is reachable by your
            organization only.
          </p>
          {access.owner === me.data ? (
            <button type="button" className="ghost" disabled={busy !== null} onClick={() => void openToLinks()}>
              {busy === "access" ? "Opening…" : "Open the workspace to public links"}
            </button>
          ) : (
            <p>Ask the workspace&apos;s owner ({shortAccount(access.owner)}) to open it to public links.</p>
          )}
        </div>
      )}
      <p className="note">
        A link reaches this form only, and only what a visitor needs: the questions and a response.
      </p>
      {error && <pre className="err">{error}</pre>}

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
