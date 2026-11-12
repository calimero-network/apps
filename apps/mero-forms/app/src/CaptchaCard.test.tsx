import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptchaCard } from "./CaptchaCard";
import type { CaptchaSettings } from "./formsApi";
import { fakeWorkspace as fakeContract } from "./test/workspace";

/** The contract's captcha settings, on the wire (camelCase). */
function fakeWorkspace(settings: CaptchaSettings) {
  const wire = {
    siteKey: settings.site_key,
    secretSet: settings.secret_set,
    teeAvailable: settings.tee_available,
    needsResealing: settings.needs_resealing,
  };
  const { workspace, call } = fakeContract({
    captchaSettings: () => wire,
    clearCaptchaSecret: () => ({ ...wire, siteKey: "" }),
  });
  return { workspace, call };
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
    const { workspace, call } = fakeWorkspace({ site_key: "0x4AAA", secret_set: false, tee_available: false, needs_resealing: false });
    render(<CaptchaCard workspace={workspace} isAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("app-forms-1", "clearCaptchaSecret", {}));
  });
});
