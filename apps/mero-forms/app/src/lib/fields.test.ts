import { describe, expect, it } from "vitest";
import type { FormView, ResponseView } from "../generated/FormsClient";
import {
  examplePayload,
  headline,
  isFieldId,
  missingRequired,
  newField,
  slugify,
  toAnswers,
  toCsv,
  uniqueId,
} from "./fields";

const form: Pick<FormView, "id" | "fields"> = {
  id: "f1",
  fields: [
    { id: "name", kind: "text", label: "Name", help: "", required: true, options: [] },
    { id: "email", kind: "email", label: "Email", help: "", required: true, options: [] },
    { id: "plan", kind: "choice", label: "Plan", help: "", required: false, options: ["Free", "Basic"] },
    { id: "tags", kind: "checkboxes", label: "Interests", help: "", required: false, options: ["Cloud", "SDK"] },
  ],
};

function response(answers: [string, string, string, string[]][], extra: Partial<ResponseView> = {}): ResponseView {
  return {
    id: "r1",
    form_id: "f1",
    answers: answers.map(([field_id, label, kind, values]) => ({ field_id, label, kind, values })),
    source: "",
    created_at: 1_700_000_000_000_000_000,
    submitted_by: "",
    archived: false,
    crm_context: "",
    crm_deal: "",
    crm_sent_at: 0,
    crm_sent_by: "",
    link: "",
    ...extra,
  };
}

describe("field ids", () => {
  it("slugs a label into an id the contract accepts", () => {
    expect(slugify("Company size")).toBe("company_size");
    expect(slugify("  Écrivez-nous! ")).toBe("ecrivez_nous");
    expect(slugify("2nd choice")).toBe("nd_choice");
    expect(slugify("???")).toBe("field");
    expect(isFieldId(slugify("x".repeat(80)))).toBe(true);
  });

  it("never reuses a taken id", () => {
    expect(uniqueId("email", ["name"])).toBe("email");
    expect(uniqueId("email", ["email", "email_2"])).toBe("email_3");
    const long = "a".repeat(40);
    expect(uniqueId(long, [long])).toHaveLength(40);
    expect(newField("email", ["email"]).id).toBe("email_2");
    expect(newField("choice", []).options.length).toBeGreaterThan(0);
  });
});

describe("filling in", () => {
  it("sends answers in form order and leaves blanks out", () => {
    expect(toAnswers(form, { email: [" a@b.co "], name: ["Ada"], plan: [""] })).toEqual([
      { field_id: "name", values: ["Ada"] },
      { field_id: "email", values: ["a@b.co"] },
    ]);
  });

  it("names what is still required", () => {
    expect(missingRequired(form, { name: ["Ada"], email: ["  "] })).toEqual(["Email"]);
  });
});

describe("reading responses", () => {
  it("heads a response with its name", () => {
    expect(headline(response([["email", "Email", "email", ["a@b.co"]], ["name", "Name", "text", ["Ada"]]]))).toBe("Ada");
    expect(headline(response([["email", "Email", "email", ["a@b.co"]]]))).toBe("a@b.co");
    expect(headline(response([]))).toBe("(empty)");
  });

  it("exports CSV with a column per question, removed ones last, formulas neutralised", () => {
    const csv = toCsv(form, [
      response([
        ["name", "Name", "text", ["=HYPERLINK(\"x\")"]],
        ["email", "Email", "email", ["a@b.co"]],
        ["tags", "Interests", "checkboxes", ["Cloud", "SDK"]],
        ["old", "Phone", "phone", ["+1 555"]],
      ]),
    ]);
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe("Name,Email,Plan,Interests,Phone (removed),Received,Source,Archived,CRM deal");
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('"Cloud, SDK"');
    expect(row).toContain("'+1 555");
  });

  it("shows a website the body it sends", () => {
    const body = JSON.parse(examplePayload(form));
    expect(body.form_id).toBe("f1");
    expect(body.answers.map((a: { field_id: string }) => a.field_id)).toEqual(["name", "email", "plan", "tags"]);
    expect(body.answers[2].values).toEqual(["Free"]);
  });
});
