import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppMode, MeroProvider } from "@calimero-network/mero-react";
import Login from "./index";

// The shared landing page needs a browser jsdom does not emulate (matchMedia,
// IntersectionObserver); all this needs from it is the CTA that opens sign-in.
vi.mock("../landing/LandingPage", () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Connect to node
    </button>
  ),
}));

describe("Login", () => {
  it("offers both sign-ins: an account (through a relay) and a node", () => {
    render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.chat">
        <MemoryRouter>
          <Login isAuthenticated={false} isConfigSet={false} />
        </MemoryRouter>
      </MeroProvider>,
    );
    // The landing's CTA opens the sign-in popup; both ways in are there.
    fireEvent.click(screen.getByRole("button", { name: /connect to node/i }));
    expect(screen.getByRole("button", { name: /i have an account/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /i run a node/i })).toBeTruthy();
  });
});
