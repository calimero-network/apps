import { describe, expect, it, vi } from "vitest";
import {
  formsClient,
  fromAnswers,
  fromCaptchaPass,
  fromCrmLink,
  fromFields,
  toForm,
  toFormView,
  toResponseView,
} from "./formsApi";
import { withRoutes } from "@calimero-apps/connect/testing";

const WIRE_FORM = {
  id: "f1",
  title: "Contact",
  description: "",
  fields: [{ id: "email", kind: "email", label: "Email", help: "", required: true, options: [] }],
  open: true,
  crm: { contextId: "crm-1", stageId: "s1", nameField: "name", emailField: "email", phoneField: "", organizationField: "", titleField: "" },
  public: false,
  linkCap: 30,
  captchaKey: "",
  createdAt: "1700000000000",
  createdBy: "acct",
  updatedAt: "1700000000500",
};

const WIRE_RESPONSE = {
  id: "r1",
  formId: "f1",
  answers: [{ fieldId: "email", label: "Email", kind: "email", values: ["a@b.co"] }],
  source: "/contact/",
  createdAt: "1700000000001",
  submittedBy: "key-1",
  link: "",
  archived: false,
  crmContext: "",
  crmDeal: "",
  crmSentAt: "0",
  crmSentBy: "",
};

describe("the adapter", () => {
  it("turns the contract's answers into the shapes the screens use", () => {
    const form = toFormView(WIRE_FORM);
    expect(form.created_at).toBe(1700000000000);
    expect(form.link_cap).toBe(30);
    expect(form.crm).toEqual({
      context_id: "crm-1",
      stage_id: "s1",
      name_field: "name",
      email_field: "email",
      phone_field: "",
      organization_field: "",
      title_field: "",
    });
    const r = toResponseView(WIRE_RESPONSE);
    expect(r.answers).toEqual([{ field_id: "email", label: "Email", kind: "email", values: ["a@b.co"] }]);
    expect(r.created_at).toBe(1700000000001);
    expect(r.submitted_by).toBe("key-1");
  });

  it("builds the record arguments in the contract's shapes", () => {
    const field = { id: "a", kind: "text", label: "A", help: "", required: false, options: ["x"] };
    expect(fromFields([field])).toEqual([field]);
    expect(
      fromCrmLink({
        context_id: "crm-1",
        stage_id: "s1",
        name_field: "name",
        email_field: "email",
        phone_field: "",
        organization_field: "",
        title_field: "",
      }),
    ).toEqual(WIRE_FORM.crm);
    expect(toForm(WIRE_FORM)).toEqual(toFormView(WIRE_FORM));
  });

  it("sends camelCase arguments, a captcha pass's expiry as a decimal string", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: "r9", events: [] });
    const after = vi.fn();
    const f = formsClient(withRoutes({ call, view: vi.fn() }), "app-1", after);
    await f.submitViaLink({
      link: "l1",
      answers: fromAnswers([{ field_id: "email", values: ["a@b.co"] }]),
      captcha: fromCaptchaPass({ nonce: "n", expires_ms: 1700000000000, signature: "s" }),
      captchaToken: null,
    });
    expect(call).toHaveBeenCalledWith("app-1", "submitViaLink", {
      link: "l1",
      answers: [{ fieldId: "email", values: ["a@b.co"] }],
      captcha: { nonce: "n", expiresMs: "1700000000000", signature: "s" },
      captchaToken: null,
    });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("turns a contract refusal into an Error carrying v1's message", async () => {
    const refusal = Object.assign(new Error("APP_ERROR"), { appCode: "Refused", fields: { message: "this form is closed" } });
    const view = vi.fn().mockRejectedValue(refusal);
    const f = formsClient(withRoutes({ call: vi.fn().mockRejectedValue(refusal), view }), "a");
    await expect(f.submitResponse({ formId: "f", answers: [], source: "" })).rejects.toThrow("this form is closed");
    await expect(f.getForm({ formId: "f" })).rejects.toMatchObject({ message: "this form is closed", appCode: "Refused" });
  });

  it("passes anything but a contract refusal through as it came", async () => {
    const down = new Error("network down");
    const f = formsClient(withRoutes({ call: vi.fn().mockRejectedValue(down), view: vi.fn() }), "a");
    await expect(f.createForm({ title: "t", description: "" })).rejects.toBe(down);
  });
});
