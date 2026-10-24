import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormKeys } from "./FormConnect";
import type { FormView } from "./generated/FormsClient";
import type { Workspace } from "./useWorkspace";

const NAMESPACE = "ab".repeat(32);
const CONTEXT = "cd".repeat(32);
const KEY_ACCOUNT = "ef".repeat(32);
const FORM: FormView = {
  id: "f0f0f0f0f0f0f0f0",
  title: "Contact",
  description: "",
  fields: [{ id: "email", kind: "email", label: "Email", help: "", required: true, options: [] }],
  open: true,
  crm: { context_id: "", stage_id: "", name_field: "", email_field: "", phone_field: "", organization_field: "", title_field: "" },
  created_at: 0,
  created_by: "",
  updated_at: 0,
  public: false,
  link_cap: 30,
  captcha_key: "",
};

const calls: string[] = [];
const createNamespaceInvitation = vi.fn(async () => {
  calls.push("invite");
  return { invitation: { invitation: { group_id: NAMESPACE }, inviter_signature: "sig" } };
});
const removeGroupMembers = vi.fn(async () => {
  calls.push("remove-member");
});
const bootstrapFromInvitation = vi.fn(async (_input: unknown) => {
  calls.push("join");
  return { ok: true as const };
});
let isDelegated = false;

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    admin: { createNamespaceInvitation, removeGroupMembers, getIntentRelay: vi.fn(async () => ({ executorAccount: "11".repeat(32), executorKey: "22".repeat(32), canAuthorOnBehalf: false })), grantAuthorship: vi.fn() },
    nodeUrl: "http://localhost:2528",
    isDelegated,
  }),
}));

vi.mock("@calimero-network/mero-js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bootstrapFromInvitation: (input: unknown) => bootstrapFromInvitation(input),
}));

/** A workspace whose client records the contract calls the screen makes. */
function fakeWorkspace(keys: unknown[] = []): Workspace & { registered: unknown[]; forgotten: unknown[] } {
  const registered: unknown[] = [];
  const forgotten: unknown[] = [];
  const client = {
    listFormKeys: vi.fn(async () => keys),
    registerFormKey: vi.fn(async (p: unknown) => {
      calls.push("register");
      registered.push(p);
    }),
    forgetFormKey: vi.fn(async (p: unknown) => {
      calls.push("forget");
      forgotten.push(p);
    }),
  };
  return {
    client: client as unknown as Workspace["client"],
    version: 0,
    act: (async (fn: (c: typeof client) => Promise<unknown>) => fn(client)) as unknown as Workspace["act"],
    registered,
    forgotten,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  isDelegated = false;
});
afterEach(cleanup);

describe("FormKeys", () => {
  it("mints a key, joins it to the namespace through this node, registers it, and shows its env once", async () => {
    const workspace = fakeWorkspace();
    render(<FormKeys form={FORM} workspace={workspace} contextId={CONTEXT} namespaceId={NAMESPACE} />);

    fireEvent.change(screen.getByLabelText("form key label"), { target: { value: " Contact page " } });
    fireEvent.click(screen.getByRole("button", { name: "Create form key" }));

    const issued = await screen.findByTestId("issued-key");
    expect(calls).toEqual(["invite", "join", "register"]);

    // The join goes to THIS node, as the minted account, with its certificate.
    const join = bootstrapFromInvitation.mock.calls[0]![0] as {
      namespaceId: string;
      nodeUrl?: string;
      credential: { account: string; credential: string; deviceSecret: string };
    };
    expect(join.namespaceId).toBe(NAMESPACE);
    expect(join.nodeUrl).toBe("http://localhost:2528");
    expect(join.credential.account).toMatch(/^[0-9a-f]{64}$/);

    expect(workspace.registered).toEqual([{ account: join.credential.account, form_id: FORM.id, label: "Contact page" }]);

    const env = issued.querySelector("pre")!.textContent!;
    expect(env).toContain(`CALIMERO_CONTEXT_ID=${CONTEXT}`);
    expect(env).toContain(`CALIMERO_FORM_ID=${FORM.id}`);
    expect(env).toContain(`CALIMERO_FORM_ACCOUNT=${join.credential.account}`);
    expect(env).toContain(`CALIMERO_FORM_DEVICE_SECRET=${join.credential.deviceSecret}`);
    expect(env).toContain(`CALIMERO_FORM_CREDENTIAL=${join.credential.credential}`);
  });

  it("lets Calimero Cloud pick the admitter for an account session", async () => {
    isDelegated = true;
    render(<FormKeys form={FORM} workspace={fakeWorkspace()} contextId={CONTEXT} namespaceId={NAMESPACE} />);
    fireEvent.change(screen.getByLabelText("form key label"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create form key" }));
    await screen.findByTestId("issued-key");
    expect((bootstrapFromInvitation.mock.calls[0]![0] as { nodeUrl?: string }).nodeUrl).toBeUndefined();
  });

  it("registers nothing and shows the reason when the join is refused", async () => {
    bootstrapFromInvitation.mockResolvedValueOnce({
      ok: false,
      step: "join",
      reason: "the node is not an admitter",
    } as never);
    const workspace = fakeWorkspace();
    render(<FormKeys form={FORM} workspace={workspace} contextId={CONTEXT} namespaceId={NAMESPACE} />);
    fireEvent.change(screen.getByLabelText("form key label"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create form key" }));
    expect(await screen.findByText(/the node is not an admitter/)).toBeTruthy();
    expect(workspace.registered).toEqual([]);
    expect(screen.queryByTestId("issued-key")).toBeNull();
  });

  it("revokes a key by removing its membership, then its registration", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const workspace = fakeWorkspace([
      { account: KEY_ACCOUNT, label: "Old site", form_id: FORM.id, created_at: 0, created_by: "", responses: 3, last_response_at: 0 },
      { account: "aa".repeat(32), label: "Another form's key", form_id: "other", created_at: 0, created_by: "", responses: 0, last_response_at: 0 },
    ]);
    render(<FormKeys form={FORM} workspace={workspace} contextId={CONTEXT} namespaceId={NAMESPACE} />);
    // Only this form's keys are listed.
    expect(await screen.findAllByRole("button", { name: "Revoke" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(calls).toEqual(["remove-member", "forget"]));
    expect(removeGroupMembers).toHaveBeenCalledWith(NAMESPACE, { members: [KEY_ACCOUNT] });
    expect(workspace.forgotten).toEqual([{ account: KEY_ACCOUNT }]);
  });
});
