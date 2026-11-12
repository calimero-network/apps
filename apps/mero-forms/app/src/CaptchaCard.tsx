import { useState } from "react";
import { useRead, type Workspace } from "./useWorkspace";
import { toCaptcha } from "./formsApi";

/**
 * The team's own Cloudflare Turnstile keys.
 *
 * In v1 the contract sealed the team's secret to the namespace's TEE and
 * checked a link's captcha with Cloudflare itself. The component runtime this
 * release runs on has no sealed secrets and no outbound requests from an app,
 * so the contract refuses the keys and says why; forms take a captcha through
 * this deployment's verifier instead (Connect → Public links → Require a
 * captcha). The card stays, with old keys removable, so the team can see where
 * the setting went.
 */
export function CaptchaCard({ workspace, isAdmin }: { workspace: Workspace; isAdmin: boolean }) {
  const settings = useRead(workspace.client, workspace.version, (c) => c.captchaSettings().then(toCaptcha), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = () => {
    if (!window.confirm("Remove the team's captcha keys?")) return;
    setBusy(true);
    setError(null);
    workspace
      .act((c) => c.clearCaptchaSecret().then(toCaptcha))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const s = settings.data;
  return (
    <section className="card" data-testid="captcha-settings">
      <h2>Captcha</h2>
      <p className="empty">
        Forms that require a captcha on their public links use this deployment&apos;s verifier: it
        checks the Cloudflare Turnstile widget and signs a pass the contract verifies.
      </p>
      {settings.error && <pre className="err">{settings.error}</pre>}
      {s && !s.tee_available && (
        <p className="note" data-testid="captcha-no-tee">
          Your team&apos;s own Turnstile keys need a TEE that can keep a secret for the app, which
          this Calimero release does not offer yet.
        </p>
      )}
      {s?.site_key && isAdmin && (
        <div className="row">
          <span className="meta">
            Old keys are set, site key <code className="mono">{s.site_key}</code>.
          </span>
          <button type="button" className="ghost danger-text" disabled={busy} onClick={clear}>
            Remove
          </button>
        </div>
      )}
      {error && <pre className="err">{error}</pre>}
    </section>
  );
}
