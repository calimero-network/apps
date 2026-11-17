import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { bindNodeShield } from "@calimero-apps/passkey";

import { ShellContext, type ShellValue } from "./shellContext";

const state = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("../../sessionContext", () => ({ useSessionApi: () => ({ api: state.api }) }));
vi.mock("../../api/names", () => ({ useMyName: () => ({ ready: true, name: "Ada", setName: vi.fn() }) }));

import UserMenu from "./UserMenu";

let unbind = () => {};
afterEach(() => {
  cleanup();
  unbind();
});

describe("Hyperfeed Design's account menu", () => {
  it("opens the node shield from its Connected to row", async () => {
    const client = {
      nodeUrl: "http://127.0.0.1:2528",
      verification: () => undefined,
      verify: async () => ({ status: "verified", url: "http://127.0.0.1:2528", mock: true, checkedAt: Date.now() }),
    } as unknown as CalimeroClient;
    const target = { kind: "local", nodes: ["http://127.0.0.1:2528"] };
    state.api = { session: { status: "signed-in", client, target, accountId: "acc-1" }, signOut: vi.fn() };
    unbind = bindNodeShield(client, "merod local (1 node)");
    render(
      <ShellContext.Provider value={{ teamId: null, openSettings: vi.fn() } as unknown as ShellValue}>
        <UserMenu account="acc-1" onLogout={vi.fn()} />
      </ShellContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("user-menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Connected to merod local (1 node)" }));
    const dialog = await screen.findByRole("dialog");
    // The shield verifies asynchronously: "Checking node…" comes first.
    await waitFor(() => expect(dialog.textContent).toContain("Test server: not sealed"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
