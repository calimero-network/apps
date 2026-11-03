import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormView } from "./formsApi";
import type { Workspace } from "./useWorkspace";

const APP = "app-forms-1";
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
const createApiKey = vi.fn(async (_options: unknown, _passkey: unknown) => {
  calls.push("create-key");
  return { keyId: "key-1", key: "mk_secret" };
});
const revokeApiKey = vi.fn(async (_id: string) => {
  calls.push("revoke-key");
});
const passkey = { kind: "passkey" };

vi.mock("./sessionContext", () => ({
  useSignedIn: () => ({ client: { createApiKey, revokeApiKey }, passkey: () => passkey, after: () => {} }),
}));

const { FormKeys } = await import("./FormConnect");

/** A workspace whose client records the contract calls the screen makes. */
function fakeWorkspace(keys: unknown[] = [], refuse = false) {
  const registered: unknown[] = [];
  const forgotten: unknown[] = [];
  const client = {
    listFormKeys: vi.fn(async () => keys),
    registerFormKey: vi.fn(async (p: unknown) => {
      calls.push("register");
      if (refuse) throw new Error("only an admin may do this");
      registered.push(p);
    }),
    forgetFormKey: vi.fn(async (p: unknown) => {
      calls.push("forget");
      forgotten.push(p);
    }),
  };
  const workspace = {
    client: client as unknown as Workspace["client"],
    version: 0,
    act: (async (fn: (c: typeof client) => Promise<unknown>) => fn(client)) as unknown as Workspace["act"],
  } as Workspace;
  return { workspace, registered, forgotten };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
});
afterEach(cleanup);

describe("FormKeys", () => {
  it("creates an API key for this workspace's two website methods, registers it, and shows its env once", async () => {
    const { workspace, registered } = fakeWorkspace();
    render(<FormKeys form={FORM} workspace={workspace} appId={APP} />);
    fireEvent.change(screen.getByLabelText("form key label"), { target: { value: " Contact page " } });
    fireEvent.click(screen.getByRole("button", { name: "Create form key" }));

    const issued = await screen.findByTestId("issued-key");
    expect(calls).toEqual(["create-key", "register"]);
    expect(createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ apps: [APP], methods: ["submitResponse", "getForm"] }),
      passkey,
    );
    expect(registered).toEqual([{ account: "key-1", form_id: FORM.id, label: "Contact page" }]);
    const env = issued.querySelector("pre")!.textContent!;
    expect(env).toContain(`CALIMERO_APP_ID=${APP}`);
    expect(env).toContain(`CALIMERO_FORM_ID=${FORM.id}`);
    expect(env).toContain("CALIMERO_API_KEY=mk_secret");
  });

  it("revokes the key again when the contract refuses to register it", async () => {
    const { workspace } = fakeWorkspace([], true);
    render(<FormKeys form={FORM} workspace={workspace} appId={APP} />);
    fireEvent.change(screen.getByLabelText("form key label"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create form key" }));
    expect(await screen.findByText(/only an admin may do this/)).toBeTruthy();
    expect(calls).toEqual(["create-key", "register", "revoke-key"]);
    expect(screen.queryByTestId("issued-key")).toBeNull();
  });

  it("revokes a key's API key, then its registration", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { workspace, forgotten } = fakeWorkspace([
      { account: "key-9", label: "Old site", form_id: FORM.id, created_at: 0, created_by: "", responses: 3, last_response_at: 0 },
      { account: "key-8", label: "Another form's key", form_id: "other", created_at: 0, created_by: "", responses: 0, last_response_at: 0 },
    ]);
    render(<FormKeys form={FORM} workspace={workspace} appId={APP} />);
    // Only this form's keys are listed.
    expect(await screen.findAllByRole("button", { name: "Revoke" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(calls).toEqual(["revoke-key", "forget"]));
    expect(revokeApiKey).toHaveBeenCalledWith("key-9");
    expect(forgotten).toEqual([{ account: "key-9" }]);
  });
});
