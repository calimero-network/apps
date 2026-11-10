import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isLogo, loadOrg, orgProfile, setOrgProfile, transferCandidates, typedMatches } from "../home";
import { ORG, fakeOrg, passkey, type FakeOrgOptions } from "../test/fakeOrg";
import { OrgSettings } from "./OrgSettings";

afterEach(cleanup);

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

async function open(opts: FakeOrgOptions = {}, readLogo = vi.fn(async () => LOGO)) {
  const fake = fakeOrg(opts);
  const view = await loadOrg(fake.asClient, ORG, fake.me);
  const onChanged = vi.fn();
  const onDeleted = vi.fn();
  const r = render(
    <OrgSettings
      client={fake.asClient}
      view={view}
      account={fake.me}
      passkey={passkey}
      after={() => {}}
      onChanged={onChanged}
      onDeleted={onDeleted}
      readLogo={readLogo}
    />,
  );
  return { fake, view, onChanged, onDeleted, readLogo, container: r.container };
}

describe("Organization settings: name and logo", () => {
  it("an admin sets the name and logo, keeping every other metadata key", async () => {
    const { fake, onChanged } = await open({ as: "admin", metadata: { "mero:createdFor": "chat" } });
    fireEvent.change(screen.getByTestId("org-name"), { target: { value: "  Acme Labs " } });
    fireEvent.change(screen.getByTestId("org-logo-file"), { target: { files: [new File(["x"], "logo.png")] } });
    expect(await screen.findByTestId("org-logo-preview")).toBeTruthy();
    fireEvent.click(screen.getByTestId("org-profile-save"));
    await waitFor(() =>
      expect(fake.client.setOrgMetadata).toHaveBeenCalledWith(ORG, {
        "mero:createdFor": "chat",
        displayName: "Acme Labs",
        logo: LOGO,
      }),
    );
    // The notice renders once the save has resolved, a tick after the call.
    expect((await screen.findByTestId("settings-notice")).textContent).toBe("Saved.");
    expect(onChanged).toHaveBeenCalled();
  });

  it("clears both, and says why a picture was refused", async () => {
    const readLogo = vi.fn(async () => {
      throw new Error("That image is too detailed to fit as a logo: try a simpler one.");
    });
    const { fake } = await open({ as: "admin", metadata: { displayName: "Acme Labs", logo: LOGO } }, readLogo);
    fireEvent.change(screen.getByTestId("org-logo-file"), { target: { files: [new File(["x"], "big.png")] } });
    expect((await screen.findByTestId("settings-error")).textContent).toContain("too detailed");
    fireEvent.change(screen.getByTestId("org-name"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("org-logo-clear"));
    fireEvent.click(screen.getByTestId("org-profile-save"));
    await waitFor(() => expect(fake.client.setOrgMetadata).toHaveBeenCalledWith(ORG, {}));
  });

  it("an admin sees no transfer or delete; a member gets nothing", async () => {
    await open({ as: "admin" });
    expect(screen.getByTestId("org-name")).toBeTruthy();
    expect(screen.queryByTestId("transfer-to")).toBeNull();
    expect(screen.queryByTestId("delete-org")).toBeNull();
    cleanup();
    const { container } = await open({ as: "member" });
    expect(container.innerHTML).toBe("");
  });
});

describe("Organization settings: the owner's", () => {
  it("transfers ownership to someone who is not a guest, after a confirm, one passkey", async () => {
    const { fake, onChanged } = await open({ as: "owner" });
    const to = screen.getByTestId("transfer-to") as HTMLSelectElement;
    expect(Array.from(to.options).map((o) => o.textContent)).toEqual(["Choose…", "Bob (Member)", "acct-cat (Member)"]);
    fireEvent.change(to, { target: { value: "acct-bob" } });
    fireEvent.click(screen.getByTestId("transfer"));
    expect(fake.client.setMember).not.toHaveBeenCalled();
    expect(screen.getByTestId("transfer-confirm").textContent).toContain("You become an admin");
    fireEvent.click(screen.getByTestId("transfer-confirm-yes"));
    await waitFor(() => expect(fake.client.setMember).toHaveBeenCalledWith(ORG, "acct-bob", "owner", expect.anything()));
    expect((await screen.findByTestId("settings-notice")).textContent).toBe("Bob owns Acme now. You are an admin.");
    expect(onChanged).toHaveBeenCalled();
  });

  it("deletes the organization only once its name is typed", async () => {
    const { fake, onDeleted } = await open({ as: "owner", metadata: { displayName: "Acme Labs" } });
    fireEvent.click(screen.getByTestId("delete-org"));
    expect(screen.getByTestId("delete-org-confirm").textContent).toContain("every app in it, with all their data");
    const yes = screen.getByTestId("delete-org-yes") as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("delete-org-typed"), { target: { value: "Acme" } });
    expect(yes.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("delete-org-typed"), { target: { value: "Acme Labs " } });
    expect(yes.disabled).toBe(false);
    fireEvent.click(yes);
    await waitFor(() => expect(fake.client.deleteOrg).toHaveBeenCalledWith(ORG, expect.anything()));
    expect(onDeleted).toHaveBeenCalled();
  });

  it("says why the node refused a delete, and stays", async () => {
    const { fake, onDeleted } = await open({ as: "owner" });
    fake.client.deleteOrg.mockRejectedValueOnce(new Error("the organization owns a deployment; delete it first"));
    fireEvent.click(screen.getByTestId("delete-org"));
    fireEvent.change(screen.getByTestId("delete-org-typed"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByTestId("delete-org-yes"));
    expect((await screen.findByTestId("settings-error")).textContent).toContain("owns a deployment");
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("profile helpers", () => {
  it("reads a name and only a small image data: URL as the logo", () => {
    expect(orgProfile({ displayName: " X ", logo: LOGO })).toEqual({ name: "X", logo: LOGO });
    expect(orgProfile({ logo: "https://example.com/a.png" }).logo).toBeNull();
    expect(orgProfile({ logo: "data:image/svg+xml;base64,PHN2Zz4=" }).logo).toBeNull();
    expect(isLogo(`data:image/png;base64,${"A".repeat(13_000)}`)).toBe(false);
    expect(orgProfile(null)).toEqual({ name: null, logo: null });
  });

  it("refuses a name over 64 characters or a logo that is not one", async () => {
    const client = { setOrgMetadata: vi.fn(async () => undefined) };
    await expect(setOrgProfile(client, ORG, {}, { name: "x".repeat(65), logo: null })).rejects.toThrow("64");
    await expect(setOrgProfile(client, ORG, {}, { name: null, logo: "data:text/html;base64,AA==" })).rejects.toThrow("logo");
    expect(client.setOrgMetadata).not.toHaveBeenCalled();
  });

  it("offers no guest and not yourself as owner; typed names must match", () => {
    const people = [
      { account: "a", role: "owner" as const, name: null },
      { account: "b", role: "admin" as const, name: null },
      { account: "g", role: "guest" as const, name: null },
    ];
    expect(transferCandidates({ people }, "a").map((p) => p.account)).toEqual(["b"]);
    expect(typedMatches(" Acme ", "Acme")).toBe(true);
    expect(typedMatches("acme", "Acme")).toBe(false);
    expect(typedMatches("", " ")).toBe(false);
  });
});
