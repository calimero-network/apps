import { describe, expect, it } from "vitest";
import { guessMapping } from "../CrmSettings";
import { parseRoute, routeHash } from "../route";
import { NO_LINK, isLinked } from "./crm";

const link = {
  ...NO_LINK,
  context_id: "ab".repeat(32),
  stage_id: "stage-lead",
  name_field: "name",
  email_field: "email",
  organization_field: "company",
};

describe("the CRM link", () => {
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
