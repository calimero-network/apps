import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalimeroClient } from "@calimero-network/mero-js";

import { InviteCard } from "./InviteCard";

// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", () => ({
  InviteDialog: (p: { open: boolean; org: string; linkBase?: string; labels?: { title?: string; noun?: string }; onInvited?: (i: { token: string; link: string }) => void }) =>
    p.open
      ? createElement(
          "div",
          { "data-testid": "invite-dialog", "data-org": p.org, "data-base": p.linkBase, "data-noun": p.labels?.noun },
          createElement("h2", null, p.labels?.title),
          createElement("button", { "data-testid": "invite-done", onClick: () => p.onInvited?.({ token: "t", link: "l" }) }, "done"),
        )
      : null,
}));

afterEach(cleanup);

const client = {} as CalimeroClient;
const passkey = () => ({ create: vi.fn(), get: vi.fn() });

describe("InviteCard", () => {
  it("invites to the scene's studio, with a link that names it, and tells the session after", () => {
    const after = vi.fn();
    render(<InviteCard client={client} org="org-1" passkey={passkey} after={after} />);
    expect(screen.queryByTestId("invite-dialog")).toBeNull();
    fireEvent.click(screen.getByText("Invite"));
    const dialog = screen.getByTestId("invite-dialog");
    expect(dialog.textContent).toContain("Invite to this scene");
    expect(dialog.dataset.org).toBe("org-1");
    expect(dialog.dataset.noun).toBe("studio");
    expect(new URL(dialog.dataset.base ?? "").searchParams.get("org")).toBe("org-1");
    fireEvent.click(screen.getByTestId("invite-done"));
    expect(after).toHaveBeenCalledOnce();
  });

  it("offers nothing for a scene without an organization", () => {
    render(<InviteCard client={client} org={null} passkey={passkey} />);
    expect(screen.queryByText("Invite")).toBeNull();
    expect(screen.getByText(/no organization/)).toBeTruthy();
  });
});
