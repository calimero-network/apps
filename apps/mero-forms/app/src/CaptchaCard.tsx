import { useState } from "react";
import { useRead, type Workspace } from "./useWorkspace";

/**
 * The team's own Cloudflare Turnstile keys, so a form's captcha is checked by
 * the team's nodes with nothing from any node operator.
 *
 * The secret never stays in this app or in readable state: the contract seals
 * it to the namespace's TEE before storing it, and only a TEE of the namespace
 * opens it, to send to Cloudflare. A namespace without a TEE cannot keep one,
 * so the form says so before it is sent and the contract refuses it anyway.
 */
export function CaptchaCard({ workspace, isAdmin }: { workspace: Workspace; isAdmin: boolean }) {
  const settings = useRead(workspace.client, workspace.version, (c) => c.captchaSettings(), []);
  const [siteKey, setSiteKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(f: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await f();
      setSecret("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(() => workspace.act((c) => c.setCaptchaSecret({ site_key: siteKey.trim(), secret: secret.trim() })));
  const clear = () => {
    if (!window.confirm("Remove the team's captcha keys? Forms then use the node operator's, if it has them.")) return;
    void run(() => workspace.act((c) => c.clearCaptchaSecret()));
  };

  const s = settings.data;
  return (
    <section className="card" data-testid="captcha-settings">
      <h2>Captcha</h2>
      <p className="empty">
        Your team&apos;s Cloudflare Turnstile keys, for forms that require a captcha on their public
        links. The secret key is sealed to your namespace&apos;s TEE node: no teammate&apos;s node
        and no page can read it, and it is only ever sent to Cloudflare.
      </p>
      {settings.error && <pre className="err">{settings.error}</pre>}
      {s && (
        <ul className="meta captcha-status">
          <li>
            {s.secret_set ? (
              <>
                Keys set{s.site_key && <>, site key <code className="mono">{s.site_key}</code></>}.
              </>
            ) : (
              "No keys set: forms use the node operator's Turnstile secret, if it has one."
            )}
          </li>
          {!s.tee_available && (
            <li className="err" data-testid="captcha-no-tee">
              Your namespace has no TEE node, so it cannot keep a captcha secret. Add a TEE node to
              the namespace first.
            </li>
          )}
          {s.needs_resealing && (
            <li className="note" data-testid="captcha-reseal">
              Your namespace&apos;s TEE nodes changed since the secret was set. It still works on the
              TEE nodes that had it; set it again so new ones can use it too.
            </li>
          )}
        </ul>
      )}
      {isAdmin ? (
        <form
          className="captcha-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            aria-label="Turnstile site key"
            placeholder="Site key"
            maxLength={200}
            value={siteKey}
            onChange={(e) => setSiteKey(e.target.value)}
          />
          <input
            aria-label="Turnstile secret key"
            placeholder="Secret key"
            type="password"
            autoComplete="off"
            maxLength={500}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <div className="row">
            <button
              type="submit"
              disabled={busy || !siteKey.trim() || !secret.trim() || s?.tee_available === false}
            >
              {busy ? "Sealing…" : s?.secret_set ? "Replace keys" : "Save keys"}
            </button>
            {s?.secret_set && (
              <button type="button" className="ghost danger-text" disabled={busy} onClick={clear}>
                Remove
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="note">Only an admin can set the captcha keys.</p>
      )}
      {error && <pre className="err">{error}</pre>}
    </section>
  );
}
