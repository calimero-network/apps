import { useState } from "react";
import type { Field, FormView } from "./generated/FormsClient";
import { missingRequired, toAnswers, type Draft } from "./lib/fields";
import type { Workspace } from "./useWorkspace";

/**
 * The form as a respondent sees it. The team uses it to preview a form and to
 * enter a response by hand (a phone call, a business card); a website renders
 * its own and submits the same answers with its form key.
 */
export function FormFill({ form, workspace }: { form: FormView; workspace: Workspace }) {
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [source, setSource] = useState("");

  const set = (id: string, values: string[]) => setDraft((d) => ({ ...d, [id]: values }));

  function submit() {
    const missing = missingRequired(form, draft);
    if (missing.length) {
      setError(`Still needed: ${missing.join(", ")}`);
      return;
    }
    setBusy(true);
    setError(null);
    workspace
      .act((c) => c.submitResponse({ form_id: form.id, answers: toAnswers(form, draft), source: source.trim() || "entered in Mero Forms" }))
      .then(() => {
        setSent(true);
        setDraft({});
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="fill">
      <section className="card fill-head">
        <h2 className="fill-title">{form.title}</h2>
        {form.description && <p className="fill-description">{form.description}</p>}
        {!form.open && <p className="note">This form is closed: it takes no new responses until it is opened again.</p>}
        <p className="meta">
          <span className="req">*</span> Required
        </p>
      </section>

      {form.fields.length === 0 && (
        <section className="card">
          <p className="empty">This form has no questions yet. Add some in Edit.</p>
        </section>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {form.fields.map((f) => (
          <section className="card question" key={f.id}>
            <FieldInput field={f} values={draft[f.id] ?? []} onChange={(v) => set(f.id, v)} />
          </section>
        ))}

        {form.fields.length > 0 && (
          <section className="card question">
            <label className="field">
              <span className="label">Where it came from (optional)</span>
              <input
                aria-label="source"
                maxLength={300}
                placeholder="e.g. phone call, trade show"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            {error && <pre className="err">{error}</pre>}
            {sent && !error && <p className="ok" role="status">Response saved.</p>}
            <div className="row">
              <button type="submit" disabled={busy || !form.open}>
                {busy ? "Saving…" : "Submit response"}
              </button>
              <button type="button" className="ghost" onClick={() => setDraft({})}>
                Clear form
              </button>
            </div>
          </section>
        )}
      </form>
    </div>
  );
}

const INPUT_TYPE: Record<string, string> = {
  text: "text",
  email: "email",
  phone: "tel",
  number: "text",
  url: "url",
  date: "date",
};

export function FieldInput({
  field,
  values,
  onChange,
}: {
  field: Field;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const label = (
    <span className="q-label">
      {field.label}
      {field.required && <span className="req"> *</span>}
    </span>
  );
  const help = field.help ? <span className="q-help">{field.help}</span> : null;

  if (field.kind === "choice" || field.kind === "checkboxes") {
    const multi = field.kind === "checkboxes";
    return (
      <fieldset className="q">
        <legend>
          {label}
          {help}
        </legend>
        {field.options.map((o) => {
          const checked = values.includes(o);
          return (
            <label className="option" key={o}>
              <input
                type={multi ? "checkbox" : "radio"}
                name={field.id}
                checked={checked}
                onChange={() =>
                  onChange(multi ? (checked ? values.filter((v) => v !== o) : [...values, o]) : [o])
                }
              />
              <span>{o}</span>
            </label>
          );
        })}
        {!multi && values.length > 0 && !field.required && (
          <button type="button" className="link" onClick={() => onChange([])}>
            Clear selection
          </button>
        )}
      </fieldset>
    );
  }

  const value = values[0] ?? "";
  return (
    <label className="q">
      {label}
      {help}
      {field.kind === "paragraph" ? (
        <textarea
          aria-label={field.label}
          rows={4}
          maxLength={10_000}
          value={value}
          placeholder="Your answer"
          onChange={(e) => onChange([e.target.value])}
        />
      ) : (
        <input
          aria-label={field.label}
          type={INPUT_TYPE[field.kind] ?? "text"}
          inputMode={field.kind === "number" ? "decimal" : undefined}
          value={value}
          placeholder={field.kind === "url" ? "https://" : "Your answer"}
          onChange={(e) => onChange([e.target.value])}
        />
      )}
    </label>
  );
}
