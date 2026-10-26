import { useEffect, useRef, useState } from "react";
import type { LinkFormView } from "./generated/FormsClient";
import { FieldInput } from "./FormFill";
import { callWithGrant, sha256Hex } from "./lib/accessGrants";
import { fetchCaptchaConfig, mountCaptcha, requestPass } from "./lib/captcha";
import { missingRequired, toAnswers, type Draft } from "./lib/fields";
import { newNonce, parsePublicLink, publicRefusal } from "./lib/publicLink";

/**
 * A form opened from its public link: no sign-in, no node of the visitor's
 * own, no member key.
 *
 * The link's fragment names a teammate's node, the workspace and an access
 * grant's token (see `lib/publicLink.ts`). This page calls that node's public
 * `/grant-calls` route with the token, for `link_form` to show the questions
 * and `submit_via_link` to send the answers. The grant names nothing else, and
 * the contract takes a response only while the form is public, under the
 * link's hourly cap, and with a captcha when the form asks for one: a pass
 * this deployment's verifier signed, or the Turnstile token itself, which the
 * contract checks with the team's own keys.
 */
export function PublicForm() {
  // Read once, on the first render: the fragment is the whole input.
  const [target] = useState(() => parsePublicLink(window.location.hash));
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

  const call = <T,>(method: string, args: Record<string, unknown>) =>
    callWithGrant<T>(target!.nodeUrl, target!.contextId, target!.token, method, args);

  useEffect(() => {
    if (!target) return;
    let live = true;
    (async () => {
      const link = await sha256Hex(target.token);
      const view = await callWithGrant<LinkFormView>(target.nodeUrl, target.contextId, target.token, "link_form", {
        link,
      });
      if (!live) return;
      setLinkId(link);
      setForm(view);
      document.title = `${view.title} · Mero Forms`;
      if (view.captcha && view.accepting) {
        // A form the contract checks itself uses the team's own site key; one
        // checked with a pass uses this deployment's verifier's.
        const key = view.captcha_by_node && view.captcha_site_key
          ? view.captcha_site_key
          : (await fetchCaptchaConfig()).siteKey;
        if (live) setSiteKey(key);
      }
    })().catch((e: unknown) => live && setLoadError(publicRefusal(e)));
    return () => {
      live = false;
    };
  }, [target]);

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
    if (!target || !form || !linkId) return;
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
      // The contract checks the token itself, or takes a pass the verifier
      // signed for it.
      const byNode = form.captcha && form.captcha_by_node;
      const captcha =
        form.captcha && !byNode && captchaToken
          ? await requestPass({ token: captchaToken, formId: form.form_id, link: linkId, nonce })
          : null;
      await call<string>("submit_via_link", {
        link: linkId,
        answers: toAnswers(form, draft),
        captcha,
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
        {target && !form && !loadError && (
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
