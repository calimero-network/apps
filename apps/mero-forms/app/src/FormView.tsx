import { FormBuilder } from "./FormBuilder";
import { FormConnect } from "./FormConnect";
import { FormFill } from "./FormFill";
import { Responses } from "./Responses";
import { isLinked } from "./lib/crm";
import type { FormTab } from "./route";
import { Icon } from "./ui";
import { useRead, type Workspace } from "./useWorkspace";

const TABS: [FormTab, string][] = [
  ["responses", "Responses"],
  ["edit", "Edit"],
  ["preview", "Preview"],
  ["connect", "Connect"],
];

/** One form: its responses, the builder, a preview to fill in, and where it connects. */
export function FormView({
  formId,
  tab,
  onTab,
  onBack,
  workspace,
  contextId,
  namespaceId,
  isAdmin,
}: {
  formId: string;
  tab: FormTab;
  onTab: (tab: FormTab) => void;
  onBack: () => void;
  workspace: Workspace;
  contextId: string;
  namespaceId: string | null;
  isAdmin: boolean;
}) {
  const form = useRead(workspace.client, workspace.version, (c) => c.getForm({ form_id: formId }), [formId]);
  const summary = useRead(workspace.client, workspace.version, (c) => c.listForms(), []);
  const counts = summary.data?.find((f) => f.id === formId);

  if (form.error && !form.data) {
    return (
      <section className="card">
        <pre className="err">{form.error}</pre>
        <button className="ghost" onClick={onBack}>
          Back to forms
        </button>
      </section>
    );
  }
  if (!form.data) return <section className="card"><p className="empty">Loading…</p></section>;
  const f = form.data;

  return (
    <>
      <div className="form-head">
        <button className="icon-button" aria-label="back to forms" onClick={onBack}>
          <Icon name="left" />
        </button>
        <h1 className="form-name">{f.title}</h1>
        {!f.open && <span className="badge badge-archived">Closed</span>}
        {isLinked(f.crm) && <span className="badge badge-crm">CRM</span>}
      </div>
      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "tab active" : "tab"}
            onClick={() => onTab(id)}
          >
            {label}
            {id === "responses" && counts && counts.new_responses > 0 && (
              <span className="count">{counts.new_responses}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === "responses" && <Responses form={f} workspace={workspace} onConnect={() => onTab("connect")} />}
      {tab === "edit" && (
        <FormBuilder form={f} workspace={workspace} responses={counts?.responses ?? 0} onDeleted={onBack} />
      )}
      {tab === "preview" && <FormFill key={f.updated_at} form={f} workspace={workspace} />}
      {tab === "connect" && (
        <FormConnect form={f} workspace={workspace} contextId={contextId} namespaceId={namespaceId} isAdmin={isAdmin} />
      )}
    </>
  );
}
