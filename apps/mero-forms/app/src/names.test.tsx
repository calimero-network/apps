// Someone who never named themselves on this team bylines by the name they set
// for the organization (org member metadata), and a name picked here is
// published to the organization.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";

const ACCOUNT = "acct-5926f2d2a4940fa2";
const client = withRoutes({
  getOrg: vi.fn(async () => ({ members: { [ACCOUNT]: "member" }, memberMetadata: { [ACCOUNT]: { name: "Ana Lee" } } })),
  setMemberMetadata: vi.fn(async () => undefined),
});
const signedIn = { client, after: () => {} };
vi.mock("./sessionContext", () => ({ useMaybeSignedIn: () => signedIn }));

const { TeamNamespace, PersonName, useSpaceNames } = await import("./names");
const { Avatar } = await import("./ui");

afterEach(cleanup);

describe("organization names", () => {
  it("bylines and avatars someone unnamed on the team by their org name", async () => {
    render(
      <TeamNamespace org="org1">
        <span data-testid="byline">
          <PersonName account={ACCOUNT} name="" />
        </span>
        <Avatar account={ACCOUNT} name="" />
      </TeamNamespace>,
    );
    await waitFor(() => expect(screen.getByTestId("byline").textContent).toBe("Ana Lee"));
    expect(screen.getByText("AL")).toBeTruthy();
    expect(client.getOrg).toHaveBeenCalledWith("org1");
  });

  it("keeps the name set on the team first", async () => {
    render(
      <TeamNamespace org="org1">
        <PersonName account={ACCOUNT} name="Ana" />
      </TeamNamespace>,
    );
    expect(screen.getByText("Ana")).toBeTruthy();
  });

  it("publishes a name picked here org-wide", async () => {
    let publish: ReturnType<typeof useSpaceNames>["publish"] | null = null;
    function Probe() {
      publish = useSpaceNames().publish;
      return null;
    }
    render(
      <TeamNamespace org="org1">
        <Probe />
      </TeamNamespace>,
    );
    publish!(ACCOUNT, " Ana ");
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org1", ACCOUNT, { name: "Ana" }));
  });
});
