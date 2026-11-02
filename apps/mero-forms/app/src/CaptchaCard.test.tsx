import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptchaCard } from "./CaptchaCard";
import type { CaptchaSettings } from "./formsApi";
import type { Workspace } from "./useWorkspace";

function fakeWorkspace(settings: CaptchaSettings) {
  const client = {
    captchaSettings: vi.fn(async () => settings),
    clearCaptchaSecret: vi.fn(async () => ({ ...settings, site_key: "" })),
  };
  const workspace = {
    client: client as unknown as Workspace["client"],
    version: 0,
    act: (async (fn: (c: typeof client) => Promise<unknown>) => fn(client)) as unknown as Workspace["act"],
  } as Workspace;
  return { workspace, client };
}

afterEach(cleanup);

describe("the team's captcha keys", () => {
  it("says team-held keys need a TEE this release lacks, and offers no secret field", async () => {
    const { workspace } = fakeWorkspace({ site_key: "", secret_set: false, tee_available: false, needs_resealing: false });
    render(<CaptchaCard workspace={workspace} isAdmin />);
    expect((await screen.findByTestId("captcha-no-tee")).textContent).toContain("TEE");
    expect(screen.queryByLabelText("Turnstile secret key")).toBeNull();
  });

  it("lets an admin remove old keys", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { workspace, client } = fakeWorkspace({ site_key: "0x4AAA", secret_set: false, tee_available: false, needs_resealing: false });
    render(<CaptchaCard workspace={workspace} isAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(client.clearCaptchaSecret).toHaveBeenCalled());
  });
});
