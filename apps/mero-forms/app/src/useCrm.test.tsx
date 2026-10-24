import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormView, ResponseView } from "./generated/FormsClient";
import type { Workspace } from "./useWorkspace";

/**
 * The hand-off under a Calimero Cloud sign-in, with the session and its
 * relays mocked: no node, an account, and a pipeline served by a different
 * relay from the one this app's session is on.
 */

const ACCOUNT = "ac".repeat(32);
const APP_RELAY = "https://relay-app.example";
const CRM_RELAY = "https://relay-crm.example";
const PIPELINE = "c1".repeat(32);
const OTHER_CONTEXT = "d2".repeat(32);
const CRM_APP = "a0".repeat(32);

/** Every execute, by the relay it went through. */
const calls: { relay: string; contextId: string; method: string; args: unknown }[] = [];
let refuse: string | null = null;

function relayClient(relay: string) {
  return {
    rpc: {
      execute: vi.fn(async ({ contextId, method, argsJson }: { contextId: string; method: string; argsJson: unknown }) => {
        calls.push({ relay, contextId, method, args: argsJson });
        if (refuse && method === "create_contact") throw new Error(refuse);
        switch (method) {
          case "list_stages":
            if (contextId !== PIPELINE) throw new Error("method not found");
            return [{ id: "stage-lead", name: "Lead in", probability: 10, position: 0 }];
          case "list_contacts":
            return [];
          case "create_contact":
            return "contact-1";
          case "create_deal":
            return "deal-1";
          default:
            return null;
        }
      }),
    },
  };
}

const appClient = relayClient(APP_RELAY);
const session = { account: ACCOUNT, credential: "cred", deviceSecret: "secret", relayUrl: APP_RELAY };
const buildDelegatedClient = vi.fn((s: { relayUrl: string }) => relayClient(s.relayUrl));

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ mero: appClient, admin: null, isDelegated: true }),
}));

vi.mock("@calimero-network/mero-js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readDelegatedSession: () => session,
  buildDelegatedClient: (s: { relayUrl: string }) => buildDelegatedClient(s),
  listDelegatedContexts: vi.fn(async () => [
    { id: PIPELINE, applicationId: CRM_APP, relayUrl: CRM_RELAY },
    { id: OTHER_CONTEXT, applicationId: "ff".repeat(32), relayUrl: APP_RELAY },
  ]),
  resolveApplicationIdFromRegistry: vi.fn(async () => ({ applicationId: CRM_APP, signerId: "s", version: "1.0.0" })),
  relayForContext: (_account: string, contextId: string) => (contextId === PIPELINE ? CRM_RELAY : null),
}));

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
  buildDelegatedClient.mockClear();
});
afterEach(cleanup);

describe("a Calimero Cloud sign-in", () => {
  it("finds the account's Mero CRM pipelines on the relay that serves each", async () => {
    const { result } = renderHook(() => usePipelines(true));
    await waitFor(() => expect(result.current.pipelines).not.toBeNull());
    expect(result.current.pipelines).toEqual([
      { contextId: PIPELINE, stages: [{ id: "stage-lead", name: "Lead in", probability: 10, position: 0 }], relayUrl: CRM_RELAY },
    ]);
    // The other app's context is not asked to be a pipeline.
    expect(calls.some((c) => c.contextId === OTHER_CONTEXT)).toBe(false);
    expect(calls.every((c) => c.relay === CRM_RELAY)).toBe(true);
  });

  it("sends a response through the pipeline's relay, then records the deal in the workspace", async () => {
    const { workspace, recorded } = fakeWorkspace();
    const { result } = renderHook(() => useSendToCrm(workspace));
    await expect(result.current(form, response)).resolves.toBe("deal-1");

    const crmCalls = calls.filter((c) => c.contextId === PIPELINE);
    expect(crmCalls.map((c) => c.method)).toEqual(["list_contacts", "create_contact", "create_deal", "add_note"]);
    expect(crmCalls.every((c) => c.relay === CRM_RELAY)).toBe(true);
    expect(buildDelegatedClient).toHaveBeenCalledWith(expect.objectContaining({ account: ACCOUNT, relayUrl: CRM_RELAY }));
    expect(recorded).toEqual([{ id: "r1", crm_context: PIPELINE, crm_deal: "deal-1" }]);
  });

  it("explains a relay that may not write CRM records on the account's behalf", async () => {
    refuse =
      "relay refused the intent (HTTP 403): this node is not a RelayTee in this namespace, and only a RelayTee signs entries on a member's behalf";
    const { workspace, recorded } = fakeWorkspace();
    const { result } = renderHook(() => useSendToCrm(workspace));
    await expect(result.current(form, response)).rejects.toThrow(/only a Calimero Cloud relay can/);
    expect(recorded).toEqual([]);
    expect(calls.some((c) => c.method === "create_deal")).toBe(false);
  });

  it("tries a pasted pipeline id directly", async () => {
    const { result } = renderHook(() => usePipelines(true, [PIPELINE]));
    await waitFor(() => expect(result.current.pipelines?.length).toBe(1));
    expect(result.current.pipelines![0]!.contextId).toBe(PIPELINE);
  });
});
