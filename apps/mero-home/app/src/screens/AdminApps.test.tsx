import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadOrg } from "../home";
import { BLOCKS, CHAT, CRM, ORG, fakeOrg, passkey } from "../test/fakeOrg";
import { AdminApps } from "./AdminApps";

afterEach(cleanup);

async function open() {
  const fake = fakeOrg({ as: "admin" });
  const view = await loadOrg(fake.asClient, ORG, fake.me);
  const onChanged = vi.fn();
  render(<AdminApps client={fake.asClient} view={view} passkey={passkey} after={() => {}} onChanged={onChanged} />);
  await screen.findByTestId(`remove-app-${CHAT}`);
  return { fake, onChanged };
}

describe("Admin: Remove app", () => {
  it("lists the instances the node says go (the app team's and those below it), then deletes after the typed name", async () => {
    const { fake, onChanged } = await open();
    fireEvent.click(screen.getByTestId(`remove-app-${CHAT}`));
    const list = await screen.findByTestId("remove-app-instances");
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["general", "leads only"]);
    expect(screen.getByTestId("remove-app-confirm").textContent).toContain("these 2 instances and all their data");
    const yes = screen.getByTestId("remove-app-yes") as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("remove-app-typed"), { target: { value: "chat" } });
    expect(yes.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("remove-app-typed"), { target: { value: "Chat" } });
    fireEvent.click(yes);
    await waitFor(() => expect(fake.client.deleteTeam).toHaveBeenCalledWith(ORG, "t-chat", expect.anything()));
    expect((await screen.findByTestId("app-removed")).textContent).toBe("Chat was removed from Acme.");
    expect(onChanged).toHaveBeenCalled();
  });

  it("an app with no instance yet: only its access list goes", async () => {
    await open();
    fireEvent.click(screen.getByTestId(`remove-app-${BLOCKS}`));
    expect((await screen.findByTestId("remove-app-none")).textContent).toContain("Nobody's data is deleted");
  });

  it("cancel deletes nothing; a legacy app offers no removal", async () => {
    const { fake } = await open();
    expect(screen.queryByTestId(`remove-app-${CRM}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`remove-app-${CHAT}`));
    await screen.findByTestId("remove-app-confirm");
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("remove-app-confirm")).toBeNull();
    expect(fake.client.deleteTeam).not.toHaveBeenCalled();
  });

  it("a refusal is said", async () => {
    const { fake } = await open();
    fake.client.deleteTeam.mockRejectedValueOnce(new Error("an app was added after the approval"));
    fireEvent.click(screen.getByTestId(`remove-app-${CHAT}`));
    fireEvent.change(await screen.findByTestId("remove-app-typed"), { target: { value: "Chat" } });
    fireEvent.click(screen.getByTestId("remove-app-yes"));
    expect((await screen.findByTestId("admin-error")).textContent).toContain("added after");
  });
});
