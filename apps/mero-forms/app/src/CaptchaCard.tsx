import { useEffect, useState } from "react";
import { useRead, type Workspace } from "./useWorkspace";

/**
 * The team's Cloudflare Turnstile setup.
 *
 * A form whose captcha the workspace checks itself (Connect → Public links →
 * "checked by the workspace") has the contract send the visitor's token to
 * Cloudflare from the visitor's own call, with the secret the node's operator
 * holds as `TURNSTILE_SECRET`: the app never sees it. The widget on the public
 * page needs the matching public site key, which admins set here (or the
 * deployment sets with `VITE_TURNSTILE_SITE_KEY`).
 *
 * v1 could also keep the team's own secret, sealed to the namespace's TEE.
 * This Calimero release has no TEE methods for apps, so the contract refuses
 * a secret and the card offers no field for one.
 */
export function CaptchaCard({ workspace, isAdmin }: { workspace: Workspace; isAdmin: boolean }) {
  const settings = useRead(workspace.client, workspace.version, (c) => c.captchaSettings(), []);
  const [siteKey, setSiteKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = settings.data?.site_key ?? "";
  useEffect(() => setSiteKey(saved), [saved]);

  const run = (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    f()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const save = () => run(() => workspace.act((c) => c.setCaptchaSiteKey({ site_key: siteKey.trim() })));
  const clear = () => {
    if (!window.confirm("Remove the team's captcha keys?")) return;
    run(() => workspace.act((c) => c.clearCaptchaSecret()));
  };

  const s = settings.data;
  return (
    <section className="card" data-testid="captcha-settings">
      <h2>Captcha</h2>
      <p className="empty">
        A form whose captcha the workspace checks sends each visitor&apos;s Cloudflare Turnstile token
        to Cloudflare from the visitor&apos;s own request, with the secret your node&apos;s operator
        holds. Nothing is stored unless Cloudflare says the captcha was solved.
      </p>
      {settings.error && <pre className="err">{settings.error}</pre>}
      {s && !s.tee_available && (
        <p className="note" data-testid="captcha-no-tee">
          Your team cannot keep its own Turnstile secret here: that needs a TEE that can keep a secret
          for the app, which this Calimero release does not offer yet. The node&apos;s operator holds
          it as <code>TURNSTILE_SECRET</code>.
        </p>
      )}
      {isAdmin ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            aria-label="Turnstile site key"
            placeholder="Turnstile site key (optional: the deployment's otherwise)"
            maxLength={200}
            value={siteKey}
            onChange={(e) => setSiteKey(e.target.value)}
          />
          <button type="submit" disabled={busy || siteKey.trim() === saved}>
            Save
          </button>
          {saved && (
            <button type="button" className="ghost danger-text" disabled={busy} onClick={clear}>
              Remove
            </button>
          )}
        </form>
      ) : (
        saved && (
          <p className="meta">
            Site key <code className="mono">{saved}</code>
          </p>
        )
      )}
      {error && <pre className="err">{error}</pre>}
    </section>
  );
}
