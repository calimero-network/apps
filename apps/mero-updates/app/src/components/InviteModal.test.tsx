import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import InviteModal from "./InviteModal";

// jsdom has `<dialog>` but not `showModal()`/`close()`. Same stubs, and the same
// reasoning, as PeopleDialog.test.tsx: keep `open` truthful so an assertion
// about openness cannot pass for a dialog that never opened.
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  proto.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  });
});

// Explicit: this project does not enable vitest globals, so RTL's auto-cleanup
// never registers and every render would stack in one document.
afterEach(cleanup);

/**
 * This component is mounted for the whole life of the page — `open` drives it
 * rather than a conditional render — so it renders with no invitation minted
 * long before it renders with one.
 *
 * That is the state that took the page down: `shareableInvitation("")` THROWS
 * ("cannot build an invitation link for an empty code"), and it was being
 * called from a `useMemo` that ran on every render including the first. The
 * whole spaces page went white on load, before anyone clicked Invite.
 *
 * The inline panel it replaced (since deleted) never hit this, because it was
 * only rendered `{invite && <panel …/>}` — the guard was in the caller, and
 * moving to an always-mounted dialog silently removed it.
 */
describe("InviteModal", () => {
  it("renders nothing, and does not throw, with no invitation yet", () => {
    expect(() =>
      render(
        <InviteModal
          open={false}
          code=""
          scope="Whole space · Test"
          onClose={() => {}}
        />,
      ),
    ).not.toThrow();
    expect(screen.queryByTestId("invite-modal")).toBeNull();
  });

  it("does not throw even if asked to open with an empty code", () => {
    // Belt and braces: a caller that sets `open` before the mint resolves must
    // not be able to crash the page either.
    expect(() =>
      render(
        <InviteModal
          open
          code=""
          scope="Whole space · Test"
          onClose={() => {}}
        />,
      ),
    ).not.toThrow();
    expect(screen.queryByTestId("invite-modal")).toBeNull();
  });

  it("treats a whitespace-only code as no code", () => {
    expect(() =>
      render(
        <InviteModal
          open
          code="   "
          scope="Whole space · Test"
          onClose={() => {}}
        />,
      ),
    ).not.toThrow();
    expect(screen.queryByTestId("invite-modal")).toBeNull();
  });

  it("renders the link once there is a code", () => {
    render(
      <InviteModal
        open
        code="abc123"
        scope="Whole space · Test"
        onClose={() => {}}
      />,
    );
    const link = screen.getByTestId("invite-link");
    expect(link.textContent).toContain("abc123");
    expect(link.textContent).toMatch(/^https?:\/\//);
    expect(screen.getByTestId("invite-scope").textContent).toBe(
      "Whole space · Test",
    );
  });
});
