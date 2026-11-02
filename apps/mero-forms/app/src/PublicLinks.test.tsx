import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormView } from "./formsApi";
import { parsePublicLink, sha256Hex } from "./lib/publicLink";
import type { Workspace } from "./useWorkspace";

/**
 * Public links with a mocked client: a link is a random token whose SHA-256
 * the contract records (no API key, no passkey), and only the workspace's
 * owner can open it to anonymous visitors.
 */

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
  public: true,
  link_cap: 30,
  captcha_key: "",
};

let access: { kind: string } = { kind: "org" };
const getApp = vi.fn(async (_app: string) => ({ appId: APP, owner: "owner-1", access }));
const setAccess = vi.fn(async (_app: string, a: { kind: string }) => {
  access = a;
});
const createApiKey = vi.fn();

vi.mock("./sessionContext", () => ({
  useSignedIn: () => ({ client: { getApp, setAccess, createApiKey }, after: () => {} }),
}));

const { PublicLinks } = await import("./PublicLinks");

function fakeWorkspace(me: string) {
  const created: { form_id: string; link: string; label: string }[] = [];
  const keys: string[] = [];
  const client = {
    listLinks: vi.fn(async () => []),
    myAccount: vi.fn(async () => me),
    createLink: vi.fn(async (p: { form_id: string; link: string; label: string }) => {
      created.push(p);
      return { id: p.link, form_id: p.form_id, label: p.label, created_at: 0, created_by: me, responses: 0, last_hour: 0, last_response_at: 0 };
    }),
    setCaptchaKey: vi.fn(async (p: { key: string }) => {
      keys.push(p.key);
      return FORM;
    }),
  };
  const workspace = {
    client: client as unknown as Workspace["client"],
    version: 0,
    act: (async (fn: (c: typeof client) => Promise<unknown>) => fn(client)) as unknown as Workspace["act"],
  } as Workspace;
  return { workspace, created, keys };
}

beforeEach(() => {
  access = { kind: "org" };
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(cleanup);

describe("public links", () => {
  it("records the SHA-256 of a fresh token and puts only the token in the link", async () => {
    const { workspace, created } = fakeWorkspace("owner-1");
    render(<PublicLinks form={FORM} workspace={workspace} appId={APP} />);
    fireEvent.change(screen.getByLabelText("public link label"), { target: { value: " newsletter " } });
    fireEvent.click(screen.getByRole("button", { name: "Create public link" }));
    const url = (await screen.findByTestId("issued-link")).querySelector("pre")!.textContent!;
    const target = parsePublicLink(new URL(url).hash)!;
    expect(target.app).toBe(APP);
    expect(target.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created).toEqual([{ form_id: FORM.id, link: await sha256Hex(target.token), label: "newsletter" }]);
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("lets the owner open the workspace to anonymous visitors", async () => {
    const { workspace } = fakeWorkspace("owner-1");
    render(<PublicLinks form={FORM} workspace={workspace} appId={APP} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open the workspace to public links" }));
    await waitFor(() => expect(setAccess).toHaveBeenCalledWith(APP, { kind: "public" }));
    await waitFor(() => expect(screen.queryByTestId("links-closed")).toBeNull());
  });

  it("tells a teammate who is not the owner whom to ask", async () => {
    const { workspace } = fakeWorkspace("bob");
    render(<PublicLinks form={FORM} workspace={workspace} appId={APP} />);
    expect((await screen.findByTestId("links-closed")).textContent).toMatch(/Ask the workspace's owner/);
    expect(screen.queryByRole("button", { name: "Open the workspace to public links" })).toBeNull();
  });

  it("says nothing about access once the workspace is public", async () => {
    access = { kind: "public" };
    const { workspace } = fakeWorkspace("owner-1");
    render(<PublicLinks form={FORM} workspace={workspace} appId={APP} />);
    await waitFor(() => expect(getApp).toHaveBeenCalled());
    expect(screen.queryByTestId("links-closed")).toBeNull();
  });

  it("has the workspace check Turnstile itself", async () => {
    const { workspace, keys } = fakeWorkspace("owner-1");
    render(<PublicLinks form={FORM} workspace={workspace} appId={APP} />);
    fireEvent.change(screen.getByLabelText("captcha"), { target: { value: "turnstile" } });
    await waitFor(() => expect(keys).toEqual(["turnstile"]));
  });
});
