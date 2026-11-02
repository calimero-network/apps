import { useEffect, useRef, useState } from "react";
import { FormsClient, type LinkFormView } from "./formsApi";
import { FieldInput } from "./FormFill";
import { fetchCaptchaConfig, mountCaptcha, requestPass } from "./lib/captcha";
import { missingRequired, toAnswers, type Draft } from "./lib/fields";
import { newNonce, parsePublicLink, publicRefusal, sha256Hex } from "./lib/publicLink";
import { useSessionApi } from "./sessionContext";

/** This deployment's Turnstile site key, for forms the contract checks; the team may set its own. */
const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";

/**
 * A form opened from its public link: no sign-in, no account of the
 * visitor's own.
 *
 * The link's fragment names the workspace (an app instance) and the link's
 * token (see `lib/publicLink.ts`). This page makes a client of its own, never
 * the page's signed-in one, with no session at all, and calls the
 * workspace's two `#[app::public]` methods anonymously: `linkForm` to show the
 * questions and `submitViaLink` to send the answers. The contract takes a
 * response only while the form is public, under the link's hourly cap, and
 * with a captcha when the form asks for one: the Turnstile token itself when
 * the contract checks it with Cloudflare, or a pass this deployment's verifier
 * signed.
 */
export function PublicForm() {
  // Read once, on the first render: the fragment is the whole input.
  const [target] = useState(() => parsePublicLink(window.location.hash));
  const { api, deps } = useSessionApi();
  // The cluster this frontend talks to.
  const where =
    api.session.status === "signed-out" || api.session.status === "signed-in" ? api.session.target : null;
  const unconfigured = api.session.status === "unconfigured" ? api.session.message : null;
  const [forms, setForms] = useState<FormsClient | null>(null);
  const [linkId, setLinkId] = useState<string | null>(null);
  const [form, setForm] = useState<LinkFormView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // The captcha: a fresh nonce per attempt, and the widget's token for it.
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [nonce, setNonce] = useState(newNonce);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target || !where) return;
    let live = true;
    (async () => {
      const client = await deps.makeClient(where);
      const f = new FormsClient(client, target.app);
      const link = await sha256Hex(target.token);
      const view = await f.linkForm({ link: target.token });
      if (!live) return;
      setForms(f);
      setLinkId(link);
      setForm(view);
      document.title = `${view.title} · Mero Forms`;
      if (view.captcha && view.accepting) {
        // Checked by the contract: the team's site key, or this deployment's.
        // Through the verifier: the verifier's.
        const key = view.captcha_by_node
          ? view.captcha_site_key || TURNSTILE_SITE_KEY || (await fetchCaptchaConfig()).siteKey
          : (await fetchCaptchaConfig()).siteKey;
        if (live) setSiteKey(key);
      }
    })().catch((e: unknown) => live && setLoadError(publicRefusal(e)));
    return () => {
      live = false;
    };
  }, [target, where, deps]);

  useEffect(() => {
    const el = captchaEl.current;
    if (!siteKey || !el || sent) return;
    let remove: (() => void) | null = null;
    let live = true;
    setCaptchaToken(null);
    mountCaptcha(el, siteKey, nonce, (t) => live && setCaptchaToken(t), () => live && setCaptchaToken(null))
      .then((r) => (live ? (remove = r) : r()))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      remove?.();
    };
  }, [siteKey, nonce, sent]);

  async function submit() {
    if (!target || !form || !linkId || !forms) return;
    const missing = missingRequired(form, draft);
    if (missing.length) {
      setError(`Still needed: ${missing.join(", ")}`);
      return;
    }
    if (form.captcha && !captchaToken) {
      setError("Please complete the human check first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Checked by the contract: the widget's token as it is. Through the
      // verifier: a pass it signed for this form, link and nonce.
      const byNode = form.captcha && form.captcha_by_node;
      const pass =
        form.captcha && !byNode && captchaToken
          ? await requestPass({ token: captchaToken, formId: form.form_id, link: linkId, nonce })
          : null;
      await forms.submitViaLink({
        link: target.token,
        answers: toAnswers(form, draft),
        captcha: pass,
        captcha_token: byNode ? captchaToken : null,
      });
      setSent(true);
      setDraft({});
    } catch (e) {
      setError(publicRefusal(e));
    } finally {
      setBusy(false);
      // A captcha token and its pass are spent either way: the next attempt
      // solves a new one.
      if (form.captcha) setNonce(newNonce());
    }
  }

  return (
    <div className="wrap public-form">
      <div className="fill">
        {!target && (
          <section className="card">
            <h2>This link is incomplete</h2>
            <p className="empty">
              The part after <code>#</code> is missing or was cut off. Copy the whole link again from
              whoever shared it.
            </p>
          </section>
        )}
        {target && unconfigured && (
          <section className="card">
            <h2>This form could not be opened</h2>
            <p className="empty">{unconfigured}</p>
          </section>
        )}
        {target && !form && !loadError && !unconfigured && (
          <section className="card">
            <p className="empty">Opening the form…</p>
          </section>
        )}
        {loadError && (
          <section className="card">
            <h2>This form could not be opened</h2>
            <p className="empty">{loadError}</p>
          </section>
        )}

        {form && sent && (
          <section className="card fill-head" data-testid="public-sent">
            <h2 className="fill-title">{form.title}</h2>
            <p className="fill-description">Your response has been recorded.</p>
            <div className="row">
              <button className="ghost" onClick={() => setSent(false)}>
                Submit another response
              </button>
            </div>
          </section>
        )}

        {form && !sent && (
          <>
            <section className="card fill-head">
              <h2 className="fill-title">{form.title}</h2>
              {form.description && <p className="fill-description">{form.description}</p>}
              {!form.accepting && <p className="note">This form is not taking responses right now.</p>}
              <p className="meta">
                <span className="req">*</span> Required
              </p>
            </section>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {form.fields.map((f) => (
                <section className="card question" key={f.id}>
                  <FieldInput field={f} values={draft[f.id] ?? []} onChange={(v) => setDraft((d) => ({ ...d, [f.id]: v }))} />
                </section>
              ))}
              <section className="card question">
                {form.captcha && form.accepting && <div ref={captchaEl} data-testid="captcha" />}
                {error && <pre className="err">{error}</pre>}
                <div className="row">
                  <button type="submit" disabled={busy || !form.accepting || form.fields.length === 0}>
                    {busy ? "Sending…" : "Submit"}
                  </button>
                  <button type="button" className="ghost" onClick={() => setDraft({})}>
                    Clear form
                  </button>
                </div>
              </section>
            </form>
          </>
        )}
        <p className="public-foot">
          <img src="./favicon.svg" alt="" width={16} height={16} /> Made with Mero Forms
        </p>
      </div>
    </div>
  );
}
