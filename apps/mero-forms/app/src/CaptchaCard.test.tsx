import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptchaCard } from "./CaptchaCard";
import type { CaptchaSettings } from "./generated/FormsClient";
import type { Workspace } from "./useWorkspace";

const NO_TEE =
  "your team's namespace has no TEE node, and only a TEE can keep a captcha secret: add a TEE node to the namespace, then set the secret again";

function fakeWorkspace(settings: CaptchaSettings, set: (p: { site_key: string; secret: string }) => Promise<CaptchaSettings>) {
  const client = {
    captchaSettings: vi.fn(async () => settings),
    setCaptchaSecret: vi.fn(set),
    clearCaptchaSecret: vi.fn(async () => settings),
  };
  const workspace = {
    client: client as unknown as Workspace["client"],
    version: 0,
    act: (async (fn: (c: typeof client) => Promise<unknown>) => fn(client)) as unknown as Workspace["act"],
  } as Workspace;
  return { workspace, client };
}

const fill = () => {
  fireEvent.change(screen.getByLabelText("Turnstile site key"), { target: { value: "0x4AAAsite" } });
  fireEvent.change(screen.getByLabelText("Turnstile secret key"), { target: { value: "0x4AAAsecret" } });
};

afterEach(cleanup);

describe("the team's captcha keys", () => {
  it("tells an admin without a TEE to add one, and does not send the secret", async () => {
    const { workspace, client } = fakeWorkspace(
      { site_key: "", secret_set: false, tee_available: false, needs_resealing: false },
      async () => {
        throw new Error(NO_TEE);
      },
    );
    render(<CaptchaCard workspace={workspace} isAdmin />);
    expect((await screen.findByTestId("captcha-no-tee")).textContent).toContain("no TEE node");
    fill();
    expect((screen.getByRole("button", { name: "Save keys" }) as HTMLButtonElement).disabled).toBe(true);
    expect(client.setCaptchaSecret).not.toHaveBeenCalled();
  });

  it("shows the contract's refusal when the namespace lost its TEE meanwhile", async () => {
    const { workspace } = fakeWorkspace(
      { site_key: "", secret_set: false, tee_available: true, needs_resealing: false },
      async () => {
        throw new Error(NO_TEE);
      },
    );
    render(<CaptchaCard workspace={workspace} isAdmin />);
    await screen.findByText(/No keys set/);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save keys" }));
    await waitFor(() => expect(screen.getByText(NO_TEE)).toBeTruthy());
  });

  it("seals the keys an admin saves and asks for them again when the TEEs changed", async () => {
    const saved = { site_key: "0x4AAAsite", secret_set: true, tee_available: true, needs_resealing: true };
    const { workspace, client } = fakeWorkspace(saved, async () => saved);
    render(<CaptchaCard workspace={workspace} isAdmin />);
    expect(await screen.findByTestId("captcha-reseal")).toBeTruthy();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Replace keys" }));
    await waitFor(() =>
      expect(client.setCaptchaSecret).toHaveBeenCalledWith({ site_key: "0x4AAAsite", secret: "0x4AAAsecret" }),
    );
    expect((screen.getByLabelText("Turnstile secret key") as HTMLInputElement).value).toBe("");
  });

  it("lets only an admin set them", async () => {
    const { workspace } = fakeWorkspace(
      { site_key: "", secret_set: false, tee_available: true, needs_resealing: false },
      async () => {
        throw new Error("unreachable");
      },
    );
    render(<CaptchaCard workspace={workspace} isAdmin={false} />);
    expect(await screen.findByText("Only an admin can set the captcha keys.")).toBeTruthy();
    expect(screen.queryByLabelText("Turnstile secret key")).toBeNull();
  });
});
