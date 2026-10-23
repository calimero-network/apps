import { useEffect, useState } from "react";
import type { Field, FormView } from "./generated/FormsClient";
import { KINDS, KIND_LABEL, isFieldId, isKind, newField, takesOptions, uniqueId, type Kind } from "./lib/fields";
import { Icon } from "./ui";
import type { Workspace } from "./useWorkspace";

/**
 * Edit a form: its title and description, and its questions — add, retype,
 * reorder, require, give choices. Changes are local until Save, which sends
 * the whole form; responses already in keep the questions they answered.
 */
export function FormBuilder({
  form,
  workspace,
  responses,
  onDeleted,
}: {
  form: FormView;
  workspace: Workspace;
  /** How many responses the form has: a form with any is closed, not deleted. */
  responses: number;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description);
  const [fields, setFields] = useState<Field[]>(form.fields);
  /** Ids the saved form already has: changing one breaks a website that sends it. */
  const [savedIds, setSavedIds] = useState(() => new Set(form.fields.map((f) => f.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A teammate's save lands while this one is clean: take it.
  const dirty =
    title !== form.title ||
    description !== form.description ||
    JSON.stringify(fields) !== JSON.stringify(form.fields);
  useEffect(() => {
    if (dirty) return;
    setTitle(form.title);
    setDescription(form.description);
    setFields(form.fields);
    setSavedIds(new Set(form.fields.map((f) => f.id)));
    // Only when the stored form moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.updated_at]);

  const update = (i: number, change: Partial<Field>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...change } : f)));
  const move = (i: number, by: number) =>
    setFields((fs) => {
      const j = i + by;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function add(kind: Kind) {
    setFields((fs) => [...fs, newField(kind, fs.map((f) => f.id))]);
    setSaved(false);
  }

  function duplicate(i: number) {
    setFields((fs) => {
      const f = fs[i]!;
      const copy = { ...f, id: uniqueId(f.id, fs.map((x) => x.id)), label: `${f.label} (copy)`, options: [...f.options] };
      return [...fs.slice(0, i + 1), copy, ...fs.slice(i + 1)];
    });
  }

  const problems = fields.flatMap((f, i) => {
    const out: string[] = [];
    if (!f.label.trim()) out.push(`Question ${i + 1} needs a label.`);
    if (!isFieldId(f.id)) out.push(`"${f.label || `Question ${i + 1}`}" has an invalid id.`);
    if (fields.findIndex((g) => g.id === f.id) !== i) out.push(`Two questions use the id "${f.id}".`);
    if (takesOptions(f.kind) && !f.options.some((o) => o.trim()))
      out.push(`"${f.label || `Question ${i + 1}`}" needs at least one option.`);
    return out;
  });

  function save() {
    setBusy(true);
    setError(null);
    workspace
      .act((c) => c.updateForm({ form_id: form.id, title, description, fields }))
      .then((v) => {
        setFields(v.fields);
        setSavedIds(new Set(v.fields.map((f) => f.id)));
        setSaved(true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }

  function toggleOpen() {
    setError(null);
    workspace
      .act((c) => c.setFormOpen({ form_id: form.id, open: !form.open }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }

  function remove() {
    if (!window.confirm(`Delete "${form.title}"? This cannot be undone.`)) return;
    workspace
      .act((c) => c.deleteForm({ form_id: form.id }))
      .then(onDeleted)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }

  return (
    <div className="builder">
      <section className="card builder-head">
        <input
          className="title-input"
          aria-label="form title"
          maxLength={200}
          value={title}
          placeholder="Form title"
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(false);
          }}
        />
        <textarea
          className="description-input"
          aria-label="form description"
          rows={2}
          maxLength={2000}
          value={description}
          placeholder="Description (optional)"
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(false);
          }}
        />
        <div className="row builder-state">
          <label className="switch">
            <input type="checkbox" checked={form.open} onChange={toggleOpen} aria-label="accepting responses" />
            <span>{form.open ? "Accepting responses" : "Closed to new responses"}</span>
          </label>
          {responses === 0 && (
            <button className="ghost danger-text" onClick={remove}>
              Delete form
            </button>
          )}
        </div>
      </section>

      {fields.map((f, i) => (
        <section className="card question-edit" key={i} data-testid={`question-${i}`}>
          <div className="q-row">
            <input
              className="q-label-input"
              aria-label={`question ${i + 1} label`}
              maxLength={200}
              value={f.label}
              placeholder="Question"
              onChange={(e) => {
                const label = e.target.value;
                // A question not yet saved takes its id from its label.
                const change: Partial<Field> = { label };
                if (!savedIds.has(f.id)) {
                  change.id = uniqueId(label || f.kind, fields.filter((_, j) => j !== i).map((x) => x.id));
                }
                update(i, change);
                setSaved(false);
              }}
            />
            <select
              aria-label={`question ${i + 1} type`}
              value={f.kind}
              onChange={(e) => {
                const kind = e.target.value;
                if (!isKind(kind)) return;
                update(i, {
                  kind,
                  options: takesOptions(kind) ? (f.options.length ? f.options : ["Option 1"]) : [],
                });
                setSaved(false);
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <input
            className="q-help-input"
            aria-label={`question ${i + 1} help`}
            maxLength={500}
            value={f.help}
            placeholder="Help text (optional)"
            onChange={(e) => {
              update(i, { help: e.target.value });
              setSaved(false);
            }}
          />

          {takesOptions(f.kind) && (
            <ul className="options-edit">
              {f.options.map((o, k) => (
                <li key={k}>
                  <span className={f.kind === "choice" ? "dot" : "box"} aria-hidden />
                  <input
                    aria-label={`question ${i + 1} option ${k + 1}`}
                    maxLength={200}
                    value={o}
                    onChange={(e) => {
                      update(i, { options: f.options.map((x, m) => (m === k ? e.target.value : x)) });
                      setSaved(false);
                    }}
                  />
                  <button
                    className="icon-button"
                    aria-label={`remove option ${k + 1}`}
                    onClick={() => update(i, { options: f.options.filter((_, m) => m !== k) })}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
              <li>
                <span className={f.kind === "choice" ? "dot" : "box"} aria-hidden />
                <button
                  className="link"
                  onClick={() => update(i, { options: [...f.options, `Option ${f.options.length + 1}`] })}
                >
                  Add option
                </button>
              </li>
            </ul>
          )}

          <div className="q-foot">
            <span className="meta" title="What a website sends this answer under">
              id{" "}
              {savedIds.has(f.id) ? (
                <code>{f.id}</code>
              ) : (
                <input
                  className="id-input mono"
                  aria-label={`question ${i + 1} id`}
                  maxLength={40}
                  value={f.id}
                  onChange={(e) => update(i, { id: e.target.value.toLowerCase() })}
                />
              )}
            </span>
            <div className="q-actions">
              <button className="icon-button" aria-label={`move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="up" />
              </button>
              <button
                className="icon-button"
                aria-label={`move question ${i + 1} down`}
                disabled={i === fields.length - 1}
                onClick={() => move(i, 1)}
              >
                <Icon name="down" />
              </button>
              <button className="icon-button" aria-label={`duplicate question ${i + 1}`} onClick={() => duplicate(i)}>
                <Icon name="copy" />
              </button>
              <button
                className="icon-button danger-text"
                aria-label={`delete question ${i + 1}`}
                onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
              >
                <Icon name="trash" />
              </button>
              <label className="switch">
                <input
                  type="checkbox"
                  aria-label={`question ${i + 1} required`}
                  checked={f.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                <span>Required</span>
              </label>
            </div>
          </div>
        </section>
      ))}

      <section className="card add-question">
        <span className="label">Add a question</span>
        <div className="kind-picker">
          {KINDS.map((k) => (
            <button key={k} className="chip" onClick={() => add(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      <div className="save-bar">
        {problems.length > 0 && <span className="err-inline">{problems[0]}</span>}
        {error && <span className="err-inline">{error}</span>}
        {saved && !dirty && !error && <span className="ok">Saved</span>}
        <button disabled={!dirty || busy || problems.length > 0 || !title.trim()} onClick={save}>
          {busy ? "Saving…" : "Save form"}
        </button>
      </div>
    </div>
  );
}
