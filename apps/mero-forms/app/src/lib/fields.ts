import type { Answer, AnswerInput, Field, FormView, ResponseView } from "../generated/FormsClient";

/** The kinds of field, in the order the builder offers them. Mirrors the contract's FIELD_KINDS. */
export const KINDS = [
  "text",
  "paragraph",
  "email",
  "phone",
  "number",
  "url",
  "date",
  "choice",
  "checkboxes",
] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  text: "Short answer",
  paragraph: "Paragraph",
  email: "Email",
  phone: "Phone",
  number: "Number",
  url: "Website",
  date: "Date",
  choice: "Multiple choice",
  checkboxes: "Checkboxes",
};

export const isKind = (k: string): k is Kind => (KINDS as readonly string[]).includes(k);
export const takesOptions = (kind: string) => kind === "choice" || kind === "checkboxes";

/** The contract's rule: lowercase letters, digits, `_` and `-`, starting with a letter, at most 40. */
export const isFieldId = (id: string) => /^[a-z][a-z0-9_-]{0,39}$/.test(id);

/** A field id from a label: `Company size` -> `company_size`. Never empty. */
export function slugify(label: string): string {
  const s = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return s || "field";
}

/** `base`, or `base_2`, `base_3`… whichever is not taken. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = isFieldId(base) ? base : slugify(base);
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = root.slice(0, 40 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}

/** A new field of `kind`, with an id no other field has. */
export function newField(kind: Kind, taken: Iterable<string>): Field {
  const label = KIND_LABEL[kind];
  return {
    id: uniqueId(kind === "url" ? "website" : kind === "text" ? "question" : kind, taken),
    kind,
    label: kind === "text" ? "Question" : label,
    help: "",
    required: false,
    options: takesOptions(kind) ? ["Option 1", "Option 2"] : [],
  };
}

/** Starting points for a new form. */
export const TEMPLATES: { id: string; title: string; description: string; fields: Field[] }[] = [
  {
    id: "contact",
    title: "Contact us",
    description: "Tell us a little about you and we'll get back to you.",
    fields: [
      { id: "name", kind: "text", label: "Name", help: "", required: true, options: [] },
      { id: "email", kind: "email", label: "Email", help: "", required: true, options: [] },
      { id: "company", kind: "text", label: "Company", help: "", required: false, options: [] },
      { id: "message", kind: "paragraph", label: "Message", help: "", required: true, options: [] },
    ],
  },
  {
    id: "demo",
    title: "Request a demo",
    description: "",
    fields: [
      { id: "name", kind: "text", label: "Name", help: "", required: true, options: [] },
      { id: "email", kind: "email", label: "Work email", help: "", required: true, options: [] },
      { id: "company", kind: "text", label: "Company", help: "", required: true, options: [] },
      {
        id: "team_size",
        kind: "choice",
        label: "Team size",
        help: "",
        required: false,
        options: ["1–10", "11–50", "51–200", "200+"],
      },
      { id: "date", kind: "date", label: "Preferred date", help: "", required: false, options: [] },
    ],
  },
  {
    id: "feedback",
    title: "Feedback",
    description: "",
    fields: [
      {
        id: "rating",
        kind: "choice",
        label: "How was it?",
        help: "",
        required: true,
        options: ["Great", "Good", "Okay", "Poor"],
      },
      { id: "comments", kind: "paragraph", label: "Anything else?", help: "", required: false, options: [] },
    ],
  },
];

/** What a filled-in form holds before it is sent: field id -> values. */
export type Draft = Record<string, string[]>;

/** The draft as the contract takes it, fields in form order, blanks left out. */
export function toAnswers(form: Pick<FormView, "fields">, draft: Draft): AnswerInput[] {
  return form.fields
    .map((f) => ({ field_id: f.id, values: (draft[f.id] ?? []).map((v) => v.trim()).filter(Boolean) }))
    .filter((a) => a.values.length > 0);
}

/** The required fields the draft leaves empty, by label. */
export function missingRequired(form: Pick<FormView, "fields">, draft: Draft): string[] {
  return form.fields
    .filter((f) => f.required && !(draft[f.id] ?? []).some((v) => v.trim()))
    .map((f) => f.label);
}

/** One answer as text. */
export const answerText = (a: Pick<Answer, "values">) => a.values.join(", ");

/** The answer a response holds for `fieldId`, as text, or "". */
export function valueOf(r: Pick<ResponseView, "answers">, fieldId: string): string {
  const a = r.answers.find((x) => x.field_id === fieldId);
  return a ? answerText(a) : "";
}

/** A response's best one-line name: the first name-ish, email or text answer. */
export function headline(r: Pick<ResponseView, "answers">): string {
  const pick =
    r.answers.find((a) => /name/i.test(a.field_id) && a.values.length) ??
    r.answers.find((a) => a.kind === "email" && a.values.length) ??
    r.answers.find((a) => a.kind === "text" && a.values.length) ??
    r.answers.find((a) => a.values.length);
  return pick ? answerText(pick) : "(empty)";
}

/** Whether a response still wants attention: not archived and not sent on. */
export const isNew = (r: Pick<ResponseView, "archived" | "crm_deal">) => !r.archived && !r.crm_deal;

/** Node timestamps are nanoseconds. */
export const fromNanos = (ns: number) => new Date(Math.floor(ns / 1e6));

export function ago(ns: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ns / 1e6) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function csvCell(v: string): string {
  // A leading = + - @ is a formula to a spreadsheet: neutralise it.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Responses as CSV: one column per field of the form as it is now, then any
 * field only older responses have (by its label then), then the bookkeeping.
 */
export function toCsv(form: Pick<FormView, "fields">, responses: ResponseView[]): string {
  const columns: { id: string; label: string }[] = form.fields.map((f) => ({ id: f.id, label: f.label }));
  const known = new Set(columns.map((c) => c.id));
  for (const r of responses) {
    for (const a of r.answers) {
      if (!known.has(a.field_id)) {
        known.add(a.field_id);
        columns.push({ id: a.field_id, label: `${a.label} (removed)` });
      }
    }
  }
  const header = [...columns.map((c) => c.label), "Received", "Source", "Archived", "CRM deal"];
  const rows = responses.map((r) => [
    ...columns.map((c) => valueOf(r, c.id)),
    fromNanos(r.created_at).toISOString(),
    r.source,
    r.archived ? "yes" : "",
    r.crm_deal,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** The request body a website's backend sends, for the Connect tab. */
export function examplePayload(form: Pick<FormView, "id" | "fields">): string {
  const example = (f: Field): string[] => {
    switch (f.kind) {
      case "email":
        return ["ada@example.com"];
      case "phone":
        return ["+44 20 7946 0958"];
      case "number":
        return ["42"];
      case "url":
        return ["https://example.com"];
      case "date":
        return ["2026-11-02"];
      case "choice":
        return f.options.slice(0, 1);
      case "checkboxes":
        return f.options.slice(0, 2);
      case "paragraph":
        return ["…"];
      default:
        return [f.label.toLowerCase().includes("name") ? "Ada Lovelace" : "…"];
    }
  };
  return JSON.stringify(
    {
      form_id: form.id,
      answers: form.fields.map((f) => ({ field_id: f.id, values: example(f) })),
      source: "/contact/",
    },
    null,
    2,
  );
}
