import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormView, ResponseView } from "./formsApi";
import type { Workspace } from "./useWorkspace";
import { withRoutes } from "@calimero-apps/connect/testing";

/**
 * The hand-off with a mocked CalimeroClient: the signed-in account reaches a
 * Mero CRM instance (a pipeline) and writes to it as itself.
 */

const PIPELINE = "crm-app-1";

/** Every call and view, in order. */
const calls: { app: string; method: string; args: unknown }[] = [];
let refuse: string | null = null;

const answer = (app: string, method: string, args: unknown) => {
  calls.push({ app, method, args });
  if (refuse && method === "createContact") return Promise.reject(new Error(refuse));
  const result = (() => {
    switch (method) {
      case "listStages":
        if (app !== PIPELINE) throw new Error("UnknownMethod");
        return [{ id: "stage-lead", name: "Lead in", probability: 10, position: "0" }];
      case "listContacts":
        return [];
      case "createContact":
        return "contact-1";
      case "createDeal":
        return "deal-1";
      default:
        return null;
    }
  })();
  return Promise.resolve({ index: 1, result, events: [] });
};

const client = withRoutes({
  call: vi.fn(answer),
  view: vi.fn(answer),
  listApps: vi.fn(async () => [{ appId: PIPELINE, name: "Sales", owner: "o", org: "org", bundle: "b", package: "com.calimero.mero-crm", version: "1" }]),
});

const signedIn = { client, after: () => {} };
vi.mock("./sessionContext", () => ({ useSignedIn: () => signedIn }));

const { usePipelines, useSendToCrm } = await import("./useCrm");

const form: FormView = {
  id: "f1",
  title: "Contact us",
  description: "",
  fields: [],
  open: true,
  crm: {
    context_id: PIPELINE,
    stage_id: "stage-lead",
    name_field: "name",
    email_field: "email",
    phone_field: "",
    organization_field: "",
    title_field: "",
  },
  created_at: 0,
  created_by: "",
  updated_at: 0,
  public: false,
  link_cap: 30,
  captcha_key: "",
};

const response: ResponseView = {
  id: "r1",
  form_id: "f1",
  answers: [
    { field_id: "name", label: "Name", kind: "text", values: ["Ada Lovelace"] },
    { field_id: "email", label: "Email", kind: "email", values: ["ada@example.com"] },
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

function fakeWorkspace() {
  const recorded: unknown[] = [];
  const client = { recordCrmDeal: vi.fn(async (p: unknown) => recorded.push(p)) };
  const workspace = {
    client: client as unknown as Workspace["client"],
    version: 0,
    act: (async (fn: (c: typeof client) => Promise<unknown>) => fn(client)) as unknown as Workspace["act"],
  };
  return { workspace, recorded };
}

beforeEach(() => {
  calls.length = 0;
  refuse = null;
});
afterEach(cleanup);

describe("the hand-off to Mero CRM", () => {
  it("finds the account's Mero CRM pipelines by package", async () => {
    const { result } = renderHook(() => usePipelines(true));
    await waitFor(() => expect(result.current.pipelines).not.toBeNull());
    expect(result.current.pipelines).toEqual([
      { contextId: PIPELINE, name: "Sales", stages: [{ id: "stage-lead", name: "Lead in", probability: 10, position: 0 }] },
    ]);
    expect(client.listApps).toHaveBeenCalledWith({ package: "com.calimero.mero-crm" });
  });

  it("sends a response to the pipeline as the signed-in account, then records the deal in the workspace", async () => {
    const { workspace, recorded } = fakeWorkspace();
    const { result } = renderHook(() => useSendToCrm(workspace));
    await expect(result.current(form, response)).resolves.toBe("deal-1");

    const crmCalls = calls.filter((c) => c.app === PIPELINE);
    expect(crmCalls.map((c) => c.method)).toEqual(["listContacts", "createContact", "createDeal", "addNote"]);
    expect(crmCalls[2]!.args).toEqual({
      title: "Ada Lovelace",
      value: "0",
      organization: "",
      contactId: "contact-1",
      stageId: "stage-lead",
      owner: null,
      expectedClose: null,
      source: "Mero Forms · Contact us",
    });
    expect(recorded).toEqual([{ id: "r1", crm_context: PIPELINE, crm_deal: "deal-1" }]);
  });

  it("records nothing when the CRM refuses", async () => {
    refuse = "Forbidden";
    const { workspace, recorded } = fakeWorkspace();
    const { result } = renderHook(() => useSendToCrm(workspace));
    await expect(result.current(form, response)).rejects.toThrow(/Forbidden/);
    expect(recorded).toEqual([]);
    expect(calls.some((c) => c.method === "createDeal")).toBe(false);
  });
});
