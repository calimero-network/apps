import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CALLS, FormsClient, VIEWS, toFormView, toResponseView } from "./formsApi";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const here = dirname(fileURLToPath(import.meta.url));
const abi = JSON.parse(readFileSync(resolve(here, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

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

describe("the adapter covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      return Promise.resolve({ index: 1, result: {}, events: [] });
    };
    const f = new FormsClient({ call: vi.fn(record), view: vi.fn(record) }, "app-1");
    const field = { id: "a", kind: "text", label: "A", help: "", required: false, options: [] };
    const link = { context_id: "", stage_id: "", name_field: "", email_field: "", phone_field: "", organization_field: "", title_field: "" };
    await Promise.all([
      f.addTeamMember({ who: "a" }),
      f.amIAdmin(),
      f.amITeam(),
      f.captchaSettings(),
      f.clearCaptchaSecret(),
      f.createForm({ title: "t", description: "" }),
      f.createLink({ form_id: "f", link: "l", grant_id: "g", label: "" }),
      f.deleteForm({ form_id: "f" }),
      f.deleteLink({ link: "l" }),
      f.fieldKinds(),
      f.forgetFormKey({ account: "a" }),
      f.getForm({ form_id: "f" }),
      f.getResponse({ id: "r" }),
      f.linkForm({ link: "l" }),
      f.listFormKeys(),
      f.listForms(),
      f.listLinks({ form_id: "f" }),
      f.listResponses({ form_id: "f" }),
      f.listTeam(),
      f.myAccount(),
      f.recordCrmDeal({ id: "r", crm_context: "c", crm_deal: "d" }),
      f.registerFormKey({ account: "a", form_id: "f", label: "l" }),
      f.removeTeamMember({ who: "a" }),
      f.setArchived({ id: "r", archived: true }),
      f.setCaptchaKey({ form_id: "f", key: "" }),
      f.setCaptchaSecret({ site_key: "s", secret: "x" }),
      f.setCrmLink({ form_id: "f", link }),
      f.setFormOpen({ form_id: "f", open: true }),
      f.setFormPublic({ form_id: "f", public: true }),
      f.setLinkCap({ form_id: "f", per_hour: 5 }),
      f.setWorkspaceName({ name: "n" }),
      f.submitResponse({ form_id: "f", answers: [], source: "" }),
      f.submitViaLink({ link: "l", answers: [], captcha: null, captcha_token: null }),
      f.updateForm({ form_id: "f", title: "t", description: "", fields: [field] }),
      f.workspaceName(),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });
});

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

  it("sends camelCase arguments, a captcha pass's expiry as a decimal string", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: "r9", events: [] });
    const after = vi.fn();
    const f = new FormsClient({ call, view: vi.fn() }, "app-1", after);
    await f.submitViaLink({
      link: "l1",
      answers: [{ field_id: "email", values: ["a@b.co"] }],
      captcha: { nonce: "n", expires_ms: 1700000000000, signature: "s" },
      captcha_token: null,
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
    const f = new FormsClient({ call: vi.fn().mockRejectedValue(refusal), view: vi.fn() }, "a");
    await expect(f.submitResponse({ form_id: "f", answers: [], source: "" })).rejects.toThrow("this form is closed");
  });
});
