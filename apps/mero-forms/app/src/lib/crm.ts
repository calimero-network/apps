import type { CrmLink, FormView, ResponseView } from "../generated/FormsClient";
import type { ContactView } from "../generated/crm/CrmClient";
import { answerText, valueOf } from "./fields";

/** Mero CRM's own limits: names and titles, and a note's body. */
const CRM_NAME = 120;
const CRM_TEXT = 10_000;

const clip = (s: string, max: number) => {
  const chars = [...s.trim()];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
};

export const isLinked = (link: CrmLink) => link.context_id !== "" && link.stage_id !== "";

export const NO_LINK: CrmLink = {
  context_id: "",
  stage_id: "",
  name_field: "",
  email_field: "",
  phone_field: "",
  organization_field: "",
  title_field: "",
};

/** What one response becomes in Mero CRM: a contact, a deal for them, and a note with every answer. */
export interface CrmPayload {
  contact: { name: string; email: string; phone: string; organization: string; job_title: string };
  deal: { title: string; organization: string; stage_id: string; source: string };
  note: string;
}

/**
 * The CRM records for a response, by the form's mapping. Clipped to the CRM's
 * limits, so a long answer never makes the CRM refuse the whole hand-off; the
 * full text is in the note.
 */
export function crmPayload(form: Pick<FormView, "title" | "crm">, response: ResponseView): CrmPayload {
  const link = form.crm;
  const pick = (id: string) => (id ? valueOf(response, id) : "");
  const name = pick(link.name_field) || pick(link.email_field) || "Form response";
  const email = pick(link.email_field);
  const organization = pick(link.organization_field);
  const title = pick(link.title_field) || (organization ? `${name} · ${organization}` : name);
  const lines = response.answers
    .filter((a) => a.values.length)
    .map((a) => `${a.label}: ${answerText(a)}`);
  if (response.source) lines.push(`Sent from: ${response.source}`);
  return {
    contact: {
      name: clip(name, CRM_NAME),
      // The CRM checks only for an @; ours already checked the address properly.
      email: email.length <= CRM_NAME ? email : "",
      phone: clip(pick(link.phone_field), CRM_NAME),
      organization: clip(organization, CRM_NAME),
      job_title: "",
    },
    deal: {
      title: clip(title, CRM_NAME),
      organization: clip(organization, CRM_NAME),
      stage_id: link.stage_id,
      source: clip(`Mero Forms · ${form.title}`, CRM_NAME),
    },
    note: clip(`From the form "${form.title}":\n\n${lines.join("\n")}`, CRM_TEXT),
  };
}

/** The CRM contact to reuse for this email, so one person sending twice is one contact. */
export function existingContact(contacts: ContactView[], email: string): ContactView | null {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  return contacts.find((c) => c.email.trim().toLowerCase() === e) ?? null;
}
