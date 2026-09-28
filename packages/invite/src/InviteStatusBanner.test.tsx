import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InviteStatusBanner } from "./InviteStatusBanner";

describe("InviteStatusBanner", () => {
  it("says what to do about a failure it can name, not the node's words", () => {
    render(
      <InviteStatusBanner
        noun="vault"
        state={{
          stage: "failed",
          message: "HTTP 409 Conflict: invitation for group g expired at 1759000000",
          reason: "expired",
          retryable: false,
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "This invitation has expired. Ask for a new link.",
    );
    expect(screen.getByRole("status").textContent).not.toContain("HTTP 409");
  });

  it("falls back to the node's message when the reason is unknown", () => {
    render(
      <InviteStatusBanner
        state={{
          stage: "failed",
          message: "could not reach any member of this namespace",
          reason: "unknown",
          retryable: true,
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "could not reach any member of this namespace",
    );
  });

  it("offers a retry only for a failure a retry can fix", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <InviteStatusBanner
        onRetry={onRetry}
        state={{ stage: "failed", message: "m", reason: "no-one-online", retryable: true }}
      />,
    );
    expect(screen.queryByText("Try again")).not.toBeNull();

    rerender(
      <InviteStatusBanner
        onRetry={onRetry}
        state={{ stage: "failed", message: "m", reason: "refused", retryable: false }}
      />,
    );
    expect(screen.queryByText("Try again")).toBeNull();
  });
});
