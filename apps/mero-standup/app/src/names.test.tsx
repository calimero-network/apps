// Someone who never named themselves on this team used to byline as
// `5926f2…1334` with "59" in their avatar, even when they had named themselves
// for the namespace. And a name picked here stayed on this team only.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const HEX = "5926f2d2a4940fa2a62edd2cd7d833897c2c1596c697ea674dd0f49b89d11334";
const admin = {
  listGroupMembers: vi.fn().mockResolvedValue({ members: [{ identity: HEX, role: "Member", name: "Ana Lee" }] }),
  getMemberMetadata: vi.fn().mockResolvedValue(null),
  setMemberMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), useMero: () => ({ admin }) }));

const { NamespaceIdProvider, PersonName, useSpaceNames } = await import("./names");
const { Avatar } = await import("./ui");

afterEach(cleanup);

describe("namespace names", () => {
  it("bylines and avatars someone unnamed on the team by their namespace name", async () => {
    render(
      <NamespaceIdProvider value="ns1">
        <span data-testid="byline">
          <PersonName account={HEX} name="" />
        </span>
        <Avatar account={HEX} name="" />
      </NamespaceIdProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("byline").textContent).toBe("Ana Lee"));
    expect(screen.getByText("AL")).toBeTruthy();
    expect(admin.listGroupMembers).toHaveBeenCalledWith("ns1");
  });

  it("keeps the name set on the team first", async () => {
    render(
      <NamespaceIdProvider value="ns1">
        <PersonName account={HEX} name="Ana" />
      </NamespaceIdProvider>,
    );
    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("publishes a name picked here namespace-wide", async () => {
    let publish: ReturnType<typeof useSpaceNames>["publish"] | null = null;
    function Probe() {
      publish = useSpaceNames().publish;
      return null;
    }
    render(
      <NamespaceIdProvider value="ns1">
        <Probe />
      </NamespaceIdProvider>,
    );
    publish!(HEX, " Ana ");
    await waitFor(() => expect(admin.setMemberMetadata).toHaveBeenCalledWith("ns1", HEX, { name: "Ana" }));
  });
});
