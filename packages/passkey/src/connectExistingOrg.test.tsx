import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OtherOrg } from "@calimero-apps/connect";

import { ConnectExistingOrg } from "./ConnectExistingOrg";

const overworld: OtherOrg = {
  orgId: "ow",
  name: "overworld",
  role: "owner",
  holds: [{ appId: "b1", name: "overworld", package: "com.calimero.mero-blocks" }],
  label: "Mero Blocks: overworld",
  canCreate: true,
};

describe("ConnectExistingOrg", () => {
  it("reads nothing and offers nothing until the person asks", async () => {
    const load = vi.fn(async () => [overworld]);
    render(<ConnectExistingOrg appName="Mero Chat" load={load} onConnect={() => {}} />);
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByTestId("connect-org-ow")).toBeNull();
    fireEvent.click(screen.getByTestId("connect-existing-org"));
    const choice = await screen.findByTestId("connect-org-ow");
    expect(choice.textContent).toContain("overworld");
    expect(choice.textContent).toContain("Mero Blocks: overworld");
  });

  it("creates the instance in the chosen organization", async () => {
    const onConnect = vi.fn(async () => {});
    render(<ConnectExistingOrg appName="Mero Chat" load={async () => [overworld]} onConnect={onConnect} defaultOpen />);
    const choice = await screen.findByTestId("connect-org-ow");
    await act(async () => fireEvent.click(choice));
    expect(onConnect).toHaveBeenCalledWith(overworld);
  });

  it("says so when there is no other organization", async () => {
    render(<ConnectExistingOrg appName="Mero Chat" load={async () => []} onConnect={() => {}} defaultOpen />);
    expect((await screen.findByTestId("connect-existing-org-empty")).textContent).toContain("Mero Chat");
  });

  it("shows a failed create and lets the person choose again", async () => {
    const onConnect = vi.fn(async () => Promise.reject(new Error("refused")));
    render(<ConnectExistingOrg appName="Mero Chat" load={async () => [overworld]} onConnect={onConnect} defaultOpen />);
    const choice = await screen.findByTestId("connect-org-ow");
    await act(async () => fireEvent.click(choice));
    await waitFor(() => expect(screen.getByTestId("connect-existing-org-error").textContent).toBe("refused"));
    expect((screen.getByTestId("connect-org-ow") as HTMLButtonElement).disabled).toBe(false);
  });
});
