import { useEffect, useState } from "react";
import type { CrmLink, Field, FormView } from "./generated/FormsClient";
import { NO_LINK, isLinked } from "./lib/crm";
import { shortAccount } from "./lib/people";
import { usePipelines } from "./useCrm";
import type { Workspace } from "./useWorkspace";

/** A first guess at which question fills which CRM field, by kind and id. */
export function guessMapping(fields: Field[]): Omit<CrmLink, "context_id" | "stage_id"> {
  const by = (test: (f: Field) => boolean) => fields.find(test)?.id ?? "";
  return {
    name_field: by((f) => /name/.test(f.id) && f.kind === "text") || by((f) => f.kind === "text"),
    email_field: by((f) => f.kind === "email"),
    phone_field: by((f) => f.kind === "phone"),
    organization_field: by((f) => /compan|organi[sz]ation|org\b|business/.test(f.id) && f.kind === "text"),
    title_field: "",
  };
}

const MAPPED: [keyof CrmLink, string, string][] = [
  ["name_field", "Contact name", "Required"],
  ["email_field", "Email", "Reuses the CRM contact with this email"],
  ["phone_field", "Phone", ""],
  ["organization_field", "Organization", ""],
  ["title_field", "Deal title", "Empty: the contact's name and organization"],
];

/**
 * Link a form to a Mero CRM pipeline: which pipeline, the stage a new deal
 * starts in, and which question fills which CRM field. Sending is then one
 * click on a response, or all new ones at once. Stored on the form, so the
 * whole team sends to the same place.
 */
export function CrmSettings({ form, workspace }: { form: FormView; workspace: Workspace }) {
  const { pipelines, error: listError, reload } = usePipelines(true);
  const [draft, setDraft] = useState<CrmLink>(() =>
    isLinked(form.crm) ? form.crm : { ...NO_LINK, ...guessMapping(form.fields) },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isLinked(form.crm)) setDraft(form.crm);
  }, [form.crm]);

  // One pipeline and nothing chosen yet: choose it.
  useEffect(() => {
    if (!pipelines || pipelines.length !== 1 || draft.context_id) return;
    const only = pipelines[0]!;
    setDraft((d) => ({ ...d, context_id: only.contextId, stage_id: only.stages[0]?.id ?? "" }));
  }, [pipelines, draft.context_id]);

  const pipeline = pipelines?.find((p) => p.contextId === draft.context_id) ?? null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(form.crm);

  function save(link: CrmLink) {
    setBusy(true);
    setError(null);
    setSaved(false);
    workspace
      .act((c) => c.setCrmLink({ form_id: form.id, link }))
      .then(() => setSaved(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }

  return (
    <section className="card" data-testid="crm-settings">
      <h2>Send responses to Mero CRM</h2>
      <p className="empty">
        Each response becomes a contact and a deal in a pipeline, with every answer in a note on
        the deal. This node writes them as your identity in that pipeline, so it has to be a
        member of it.
      </p>

      {listError && <pre className="err">{listError}</pre>}
      {pipelines === null && !listError && <p className="empty">Looking for pipelines on this node…</p>}
      {pipelines !== null && pipelines.length === 0 && (
        <p className="note">
          This node is not in any Mero CRM pipeline. Install Mero CRM, create a pipeline or join
          one, then{" "}
          <button className="link" onClick={reload}>
            look again
          </button>
          .
        </p>
      )}

      {pipelines !== null && pipelines.length > 0 && (
        <div className="crm-grid">
          <label className="field">
            <span className="label">Pipeline</span>
            <select
              aria-label="crm pipeline"
              value={draft.context_id}
              onChange={(e) => {
                const p = pipelines.find((x) => x.contextId === e.target.value);
                setDraft((d) => ({ ...d, context_id: e.target.value, stage_id: p?.stages[0]?.id ?? "" }));
              }}
            >
              <option value="">Choose a pipeline</option>
              {pipelines.map((p) => (
                <option key={p.contextId} value={p.contextId}>
                  Pipeline {shortAccount(p.contextId)} · {p.stages.length} stages
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">New deals start in</span>
            <select
              aria-label="crm stage"
              value={draft.stage_id}
              disabled={!pipeline}
              onChange={(e) => setDraft((d) => ({ ...d, stage_id: e.target.value }))}
            >
              {(pipeline?.stages ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {MAPPED.map(([key, label, hint]) => (
            <label className="field" key={key}>
              <span className="label">{label}</span>
              <select
                aria-label={`crm ${label.toLowerCase()}`}
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              >
                <option value="">{key === "name_field" ? "Choose a question" : "Nothing"}</option>
                {form.fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              {hint && <span className="hint-plain">{hint}</span>}
            </label>
          ))}
        </div>
      )}

      {error && <pre className="err">{error}</pre>}
      <div className="row">
        {pipelines !== null && pipelines.length > 0 && (
          <button
            disabled={busy || !dirty || !draft.context_id || !draft.stage_id || !draft.name_field}
            onClick={() => save(draft)}
          >
            {busy ? "Saving…" : isLinked(form.crm) ? "Save changes" : "Connect to CRM"}
          </button>
        )}
        {isLinked(form.crm) && (
          <button className="ghost" disabled={busy} onClick={() => save(NO_LINK)}>
            Disconnect
          </button>
        )}
        {saved && !dirty && <span className="ok">Saved</span>}
        {isLinked(form.crm) && !dirty && !saved && (
          <span className="ok" data-testid="crm-linked">
            Connected
          </span>
        )}
      </div>
    </section>
  );
}
