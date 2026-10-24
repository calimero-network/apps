import { useEffect, useMemo, useState } from "react";
import { RelayClient, relayTransportFetch } from "@calimero-network/mero-js";
import type { FormView } from "./generated/FormsClient";
import { FieldInput } from "./FormFill";
import { missingRequired, toAnswers, type Draft } from "./lib/fields";
import { clockNonces, parsePublicLink, publicRefusal, sendWithSkips } from "./lib/publicLink";

/**
 * A form opened from its public link: no sign-in, no node.
 *
 * The link's fragment carries a form key (see `lib/publicLink.ts`). This page
 * reads it, asks the relay for the form's questions with `get_form`, and
 * sends the answers with `submit_response`, each signed in this browser and
 * run by the relay as the key's account. Nothing goes through the server the
 * page was loaded from.
 */
export function PublicForm() {
  // Read once, on the first render: the fragment is the whole input.
  const [link] = useState(() => parsePublicLink(window.location.hash));
  const nonces = useMemo(() => clockNonces(), []);
  const relay = useMemo(
    () =>
      link &&
      new RelayClient({
        relayUrl: link.relayUrl,
        authorAccount: link.account,
        authorProof: link.credential,
        deviceSecret: link.deviceSecret,
        nonces,
        // Sealed to the relay's attested TEE; plain only for a loopback dev node.
        fetch: relayTransportFetch(link.relayUrl),
      }),
    [link, nonces],
  );
  const [form, setForm] = useState<FormView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!link || !relay) return;
    let live = true;
    sendWithSkips(nonces, () => relay.execute<FormView>(link.contextId, "get_form", { form_id: link.formId }))
      .then((r) => {
        if (!live) return;
        if (!r.returns) throw new Error("no form");
        setForm(r.returns);
        document.title = `${r.returns.title} · Mero Forms`;
      })
      .catch((e: unknown) => live && setLoadError(publicRefusal(e)));
    return () => {
      live = false;
    };
  }, [link, relay, nonces]);

  function submit() {
    if (!link || !relay || !form) return;
    const missing = missingRequired(form, draft);
    if (missing.length) {
      setError(`Still needed: ${missing.join(", ")}`);
      return;
    }
    setBusy(true);
    setError(null);
    sendWithSkips(nonces, () =>
      relay.execute<string>(link.contextId, "submit_response", {
        form_id: form.id,
        answers: toAnswers(form, draft),
        source: "public link",
      }),
    )
      .then(() => {
        setSent(true);
        setDraft({});
      })
      .catch((e: unknown) => setError(publicRefusal(e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="wrap public-form">
      <div className="fill">
        {!link && (
          <section className="card">
            <h2>This link is incomplete</h2>
            <p className="empty">
              The part after <code>#</code> is missing or was cut off. Copy the whole link again from
              whoever shared it.
            </p>
          </section>
        )}
        {link && !form && !loadError && (
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
              {!form.open && <p className="note">This form is closed and is not taking responses.</p>}
              <p className="meta">
                <span className="req">*</span> Required
              </p>
            </section>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {form.fields.map((f) => (
                <section className="card question" key={f.id}>
                  <FieldInput field={f} values={draft[f.id] ?? []} onChange={(v) => setDraft((d) => ({ ...d, [f.id]: v }))} />
                </section>
              ))}
              <section className="card question">
                {error && <pre className="err">{error}</pre>}
                <div className="row">
                  <button type="submit" disabled={busy || !form.open || form.fields.length === 0}>
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
          <img src="/favicon.svg" alt="" width={16} height={16} /> Made with Mero Forms
        </p>
      </div>
    </div>
  );
}
