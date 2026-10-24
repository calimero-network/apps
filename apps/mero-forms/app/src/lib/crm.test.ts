import { describe, expect, it } from "vitest";
import type { ResponseView } from "../generated/FormsClient";
import type { ContactView } from "../generated/crm/CrmClient";
import { guessMapping } from "../CrmSettings";
import { parseRoute, routeHash } from "../route";
import { NO_LINK, crmPayload, existingContact, isLinked } from "./crm";

const response: ResponseView = {
  id: "r1",
  form_id: "f1",
  answers: [
    { field_id: "name", label: "Name", kind: "text", values: ["Ada Lovelace"] },
    { field_id: "email", label: "Email", kind: "email", values: ["ada@example.com"] },
    { field_id: "company", label: "Company", kind: "text", values: ["Analytical Engines"] },
    { field_id: "topic", label: "Topic", kind: "checkboxes", values: ["Cloud", "SDK"] },
    { field_id: "blank", label: "Phone", kind: "phone", values: [] },
  ],
  source: "/contact/",
  created_at: 0,
  submitted_by: "",
  archived: false,
  crm_context: "",
  crm_deal: "",
  crm_sent_at: 0,
  crm_sent_by: "",
  link: "",
};

const link = {
  ...NO_LINK,
  context_id: "ab".repeat(32),
  stage_id: "stage-lead",
  name_field: "name",
  email_field: "email",
  organization_field: "company",
};

describe("the CRM hand-off", () => {
  it("makes a contact, a deal in the chosen stage, and a note with every answer", () => {
    const p = crmPayload({ title: "Contact us", crm: link }, response);
    expect(p.contact).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "",
      organization: "Analytical Engines",
      job_title: "",
    });
    expect(p.deal).toEqual({
      title: "Ada Lovelace · Analytical Engines",
      organization: "Analytical Engines",
      stage_id: "stage-lead",
      source: "Mero Forms · Contact us",
    });
    expect(p.note).toContain("Topic: Cloud, SDK");
    expect(p.note).toContain("Sent from: /contact/");
    expect(p.note).not.toContain("Phone:");
  });

  it("titles the deal from the mapped question, and keeps to the CRM's limits", () => {
    const long = { ...response, answers: [...response.answers, { field_id: "t", label: "T", kind: "text", values: ["x".repeat(300)] }] };
    const p = crmPayload({ title: "F", crm: { ...link, title_field: "t" } }, long);
    expect([...p.deal.title]).toHaveLength(120);
    expect(p.deal.title.endsWith("…")).toBe(true);
    expect(p.note).toContain("x".repeat(300));
  });

  it("falls back when nothing names the contact", () => {
    const p = crmPayload({ title: "F", crm: { ...link, name_field: "", email_field: "" } }, response);
    expect(p.contact.name).toBe("Form response");
  });

  it("reuses the contact with the same email", () => {
    const contacts = [{ id: "c1", email: " ADA@example.com " }, { id: "c2", email: "" }] as ContactView[];
    expect(existingContact(contacts, "ada@example.com")?.id).toBe("c1");
    expect(existingContact(contacts, "")).toBeNull();
  });

  it("knows a linked form", () => {
    expect(isLinked(NO_LINK)).toBe(false);
    expect(isLinked(link)).toBe(true);
  });

  it("guesses which question fills which CRM field", () => {
    expect(
      guessMapping([
        { id: "full_name", kind: "text", label: "", help: "", required: true, options: [] },
        { id: "work_email", kind: "email", label: "", help: "", required: true, options: [] },
        { id: "company", kind: "text", label: "", help: "", required: false, options: [] },
        { id: "tel", kind: "phone", label: "", help: "", required: false, options: [] },
      ]),
    ).toEqual({
      name_field: "full_name",
      email_field: "work_email",
      phone_field: "tel",
      organization_field: "company",
      title_field: "",
    });
  });
});

describe("routes", () => {
  it("round-trips a form tab through the hash", () => {
    const r = { page: "form" as const, id: "abc123", tab: "connect" as const };
    expect(parseRoute(routeHash(r))).toEqual(r);
    expect(parseRoute("#/form/abc123/nope")).toEqual({ page: "form", id: "abc123", tab: "responses" });
    expect(parseRoute("#/form/NOT-HEX")).toEqual({ page: "forms" });
    expect(parseRoute("#/team")).toEqual({ page: "team" });
    expect(parseRoute("")).toEqual({ page: "forms" });
  });
});
