import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormKeys } from "./FormConnect";
import type { FormView } from "./generated/FormsClient";
import type { Workspace } from "./useWorkspace";

const CONTEXT = "cd".repeat(32);
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

/** The cluster's API-key routes, as the cloud client calls them. */
const apiKeys: Array<{ keyId: string; label: string; expiresAt: number }> = [];
const mero = {
  baseUrl: "https://cloud.example",
  post: vi.fn(async (path: string, body: { label: string; apps: string[]; methods: string[] }) => {
    expect(path).toBe("auth/apikeys");
    const keyId = `k${apiKeys.length + 1}`;
    apiKeys.push({ keyId, label: body.label, expiresAt: 0 });
    return { keyId, key: `secret-${keyId}` };
  }),
  get: vi.fn(async () => ({ keys: apiKeys })),
  delete: vi.fn(async (path: string) => {
    const i = apiKeys.findIndex((k) => path.endsWith(`/${k.keyId}`));
    if (i >= 0) apiKeys.splice(i, 1);
    return {};
  }),
};

vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ mero, nodeUrl: "https://cloud.example" }),
}));

const workspace = { client: {}, version: 0, act: vi.fn() } as unknown as Workspace;

beforeEach(() => {
  vi.clearAllMocks();
  apiKeys.length = 0;
});
afterEach(cleanup);

function mount() {
  return render(<FormKeys form={FORM} workspace={workspace} contextId={CONTEXT} namespaceId={null} />);
}

describe("FormKeys", () => {
  it("issues an API key that may only submit responses to this app, and shows its env once", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("form key label"), { target: { value: "contact page" } });
    fireEvent.click(screen.getByRole("button", { name: "Create form key" }));
    const issued = await screen.findByTestId("issued-key");
    expect(mero.post).toHaveBeenCalledWith("auth/apikeys", {
      label: `mero-forms:${FORM.id}:contact page`,
      apps: [CONTEXT],
      methods: ["submit_response"],
    });
    expect(issued.textContent).toContain("CALIMERO_URL=https://cloud.example");
    expect(issued.textContent).toContain(`CALIMERO_APP_ID=${CONTEXT}`);
    expect(issued.textContent).toContain(`CALIMERO_FORM_ID=${FORM.id}`);
    expect(issued.textContent).toContain("CALIMERO_API_KEY=secret-k1");
    await waitFor(() => expect(screen.getAllByText("contact page")).toHaveLength(2)); // the issued card and the list
  });

  it("lists only this form's keys", async () => {
    apiKeys.push(
      { keyId: "a", label: `mero-forms:${FORM.id}:mine`, expiresAt: 0 },
      { keyId: "b", label: "mero-forms:another-form:theirs", expiresAt: 0 },
      { keyId: "c", label: "a key for something else", expiresAt: 0 },
    );
    mount();
    await screen.findByText("mine");
    expect(screen.queryByText("theirs")).toBeNull();
    expect(screen.queryByText("a key for something else")).toBeNull();
  });

  it("revokes a key on the cluster", async () => {
    apiKeys.push({ keyId: "a", label: `mero-forms:${FORM.id}:mine`, expiresAt: 0 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount();
    await screen.findByText("mine");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(mero.delete).toHaveBeenCalledWith("auth/apikeys/a"));
    await waitFor(() => expect(screen.getByText("No form keys yet.")).toBeTruthy());
  });

  it("shows the cluster's refusal and issues nothing", async () => {
    mero.post.mockRejectedValueOnce(new Error("quota exceeded: too many API keys"));
    mount();
    fireEvent.change(screen.getByLabelText("form key label"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create form key" }));
    await screen.findByText(/quota exceeded/);
    expect(screen.queryByTestId("issued-key")).toBeNull();
  });
});
