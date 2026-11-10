import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadOrg } from "../home";
import { BLOCKS, CHAT, ORG, fakeOrg, passkey, type FakeOrgOptions } from "../test/fakeOrg";
import { AdminApps } from "./AdminApps";

afterEach(cleanup);

async function open(opts: FakeOrgOptions = {}) {
  const fake = fakeOrg({ as: "admin", ...opts });
  const view = await loadOrg(fake.asClient, ORG, fake.me);
  const onChanged = vi.fn();
  render(<AdminApps client={fake.asClient} view={view} passkey={passkey} after={() => {}} onChanged={onChanged} />);
  await screen.findByTestId("apart-switch");
  return { fake, onChanged, sw: screen.getByTestId("apart-switch") as HTMLInputElement };
}

describe("Admin: Keep apps apart", () => {
  it("is off while every app is open: everyone has every app", async () => {
    const { sw } = await open({ mode: "standalone" });
    expect(sw.checked).toBe(false);
    expect(screen.getByTestId("apart-state").textContent).toBe("Everyone in the organization has every app");
  });

  it("turning it on warns first, then closes every app team in one passkey step, keeping everyone who has each app", async () => {
    const { fake, sw, onChanged } = await open({ mode: "standalone" });
    fireEvent.click(sw);
    expect(fake.client.scopeApps).not.toHaveBeenCalled();
    expect(screen.getByTestId("apart-confirm").textContent).toContain(
      "Someone who joins the organization from now on gets only the apps their invitation names.",
    );
    expect(screen.getByTestId("apart-keeps").textContent).toContain("Blocks (1 person), Chat (3 people)");
    fireEvent.click(screen.getByTestId("apart-confirm-yes"));
    await waitFor(() => expect(fake.client.scopeApps).toHaveBeenCalledWith(ORG, expect.anything(), { apps: [], shared: true }));
    expect(fake.client.scopeApps).toHaveBeenCalledTimes(1);
    expect(fake.client.updateTeam).not.toHaveBeenCalled();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("cancel leaves it off and changes nothing", async () => {
    const { fake, sw } = await open({ mode: "standalone" });
    fireEvent.click(sw);
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("apart-confirm")).toBeNull();
    expect(sw.checked).toBe(false);
    expect(fake.client.scopeApps).not.toHaveBeenCalled();
  });

  it("is on once an app lists its own people; turning it off opens every closed app, no passkey", async () => {
    const { fake, sw, onChanged } = await open({ chatOpen: true });
    expect(sw.checked).toBe(true);
    expect(screen.getByTestId("apart-state").textContent).toBe("Each app lists who is in it · open to everyone: Chat");
    fireEvent.click(sw);
    expect(screen.getByTestId("apart-confirm").textContent).toContain("Everyone in the organization gets Blocks");
    fireEvent.click(screen.getByTestId("apart-confirm-yes"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fake.client.updateTeam.mock.calls).toEqual([[ORG, "t-blocks", { join: "everyone" }]]);
    expect(fake.client.scopeApps).not.toHaveBeenCalled();
  });

  it("a refusal while opening says which apps still list their own people", async () => {
    const { fake, sw } = await open();
    fake.client.updateTeam.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("not allowed"));
    fireEvent.click(sw);
    fireEvent.click(screen.getByTestId("apart-confirm-yes"));
    expect((await screen.findByTestId("admin-error")).textContent).toContain("Still listing their own people: Chat.");
  });

  it("opens one app to everyone on its own; no per-app close is offered", async () => {
    const { fake } = await open({ chatOpen: true });
    expect(screen.queryByTestId(`open-${CHAT}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`open-${BLOCKS}`));
    await waitFor(() => expect(fake.client.updateTeam).toHaveBeenCalledWith(ORG, "t-blocks", { join: "everyone" }));
    expect(screen.queryByText(/^Close /)).toBeNull();
  });
});
