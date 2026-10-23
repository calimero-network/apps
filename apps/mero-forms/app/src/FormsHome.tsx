import { useState } from "react";
import { TEMPLATES, ago } from "./lib/fields";
import { Icon } from "./ui";
import { useRead, type Workspace } from "./useWorkspace";

/** Every form in the workspace, and a way to start a new one. */
export function FormsHome({
  workspace,
  onOpen,
}: {
  workspace: Workspace;
  onOpen: (formId: string, tab?: "responses" | "edit") => void;
}) {
  const forms = useRead(workspace.client, workspace.version, (c) => c.listForms(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(template: (typeof TEMPLATES)[number] | null) {
    setBusy(template?.id ?? "blank");
    setError(null);
    try {
      const title = template?.title ?? "Untitled form";
      const description = template?.description ?? "";
      const id = await workspace.act((c) => c.createForm({ title, description }));
      if (template) {
        await workspace.act((c) => c.updateForm({ form_id: id, title, description, fields: template.fields }));
      }
      onOpen(id, "edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card start">
        <h2>Start a new form</h2>
        <div className="templates">
          <button className="template blank" disabled={busy !== null} onClick={() => void create(null)}>
            <span className="template-art">
              <Icon name="plus" size={22} />
            </span>
            <span className="template-name">{busy === "blank" ? "Creating…" : "Blank form"}</span>
          </button>
          {TEMPLATES.map((t) => (
            <button key={t.id} className="template" disabled={busy !== null} onClick={() => void create(t)}>
              <span className="template-art">
                <Icon name="form" size={22} />
              </span>
              <span className="template-name">{busy === t.id ? "Creating…" : t.title}</span>
              <span className="meta">{t.fields.length} questions</span>
            </button>
          ))}
        </div>
        {error && <pre className="err">{error}</pre>}
      </section>

      <section className="card">
        <h2>Your forms</h2>
        {forms.error && <pre className="err">{forms.error}</pre>}
        {forms.data && forms.data.length === 0 && (
          <p className="empty">No forms yet. Start one above.</p>
        )}
        {forms.data && forms.data.length > 0 && (
          <ul className="form-list">
            {forms.data.map((f) => (
              <li key={f.id}>
                <button className="form-row" onClick={() => onOpen(f.id)} data-testid="form-row">
                  <span className="form-icon">
                    <Icon name="form" />
                  </span>
                  <span className="form-main">
                    <span className="form-title">{f.title}</span>
                    <span className="meta">
                      {f.fields} {f.fields === 1 ? "question" : "questions"} ·{" "}
                      {f.last_response_at ? `last response ${ago(f.last_response_at)}` : `created ${ago(f.created_at)}`}
                    </span>
                  </span>
                  {!f.open && <span className="badge badge-archived">Closed</span>}
                  <span className="form-counts">
                    {f.new_responses > 0 && <span className="badge badge-new">{f.new_responses} new</span>}
                    <span className="meta">
                      {f.responses} {f.responses === 1 ? "response" : "responses"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
