import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeeBadge } from "./ui";

afterEach(cleanup);

// A TEE node is never listed or counted as a member; this badge is where its
// presence shows instead.
describe("TeeBadge", () => {
  it("says TEE enabled, with the mode and what the node does", () => {
    render(<TeeBadge mode="relay" />);
    const badge = screen.getByTestId("tee-badge");
    expect(badge.textContent).toContain("TEE enabled");
    expect(badge.textContent).toContain("Relay");
    expect(badge.title).toMatch(
      /hardware-attested node keeps this workspace in sync and available when members are offline/,
    );
  });

  it("names a read-only TEE node a replica", () => {
    render(<TeeBadge mode="replica" />);
    expect(screen.getByTestId("tee-badge").textContent).toContain("Replica");
  });

  it("renders nothing without a TEE node", () => {
    render(<TeeBadge mode={null} />);
    expect(screen.queryByTestId("tee-badge")).toBeNull();
  });
});
