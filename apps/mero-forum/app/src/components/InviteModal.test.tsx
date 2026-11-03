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
 * That is the state that once took the page down (v1 built the link from the
 * code and threw on an empty one, on every render including the first), so an
 * empty code must still render nothing.
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
        code="http://localhost:5173/?invite=abc123"
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

  it("offers the link and nothing else to share", () => {
    // An invitation reaches the app only by its link being opened (an org
    // invite token in `?invite=`), so there is no raw code to hand out instead.
    render(
      <InviteModal
        open
        code="https://forum.example/?invite=abc123&forum=app1"
        scope="Whole space · Test"
        onClose={() => {}}
      />,
    );
    const modal = screen.getByTestId("invite-modal");
    expect(screen.queryByTestId("invite-more")).toBeNull();
    expect(modal.textContent).not.toContain("calimero://");
    expect(screen.getByTestId("invite-link").getAttribute("title")).toBe(
      "https://forum.example/?invite=abc123&forum=app1",
    );
  });
});
