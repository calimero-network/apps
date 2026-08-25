import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import PeopleDialog from "./PeopleDialog";
import type { Person } from "../lib/people";

/**
 * jsdom has `<dialog>` but not `showModal()`/`close()` — they are unimplemented
 * and throw "Not implemented". The component drives the element through them
 * deliberately (that is what buys the backdrop, the focus trap and Escape), so
 * without stubs every test here fails on the environment rather than on the code.
 *
 * The stubs keep `open` truthful, because that is the property the assertions
 * read: a stub that always reported open would make "closes when asked" pass for
 * a dialog that never closes.
 */
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

// Explicit, because this project does not enable vitest globals — so RTL's
// auto-cleanup never registers and every render stacks in one document. The
// symptom is "found multiple elements" on the second test that queries by id,
// which reads as a duplicate-testid bug in the component.
afterEach(cleanup);

const PEOPLE: Person[] = [
  { memberId: "me-0123456789abcdef", name: "You", live: true, isSelf: true },
  { memberId: "ana-0123456789abcdef", name: "Ana", live: true, isSelf: false },
  { memberId: "bo-0123456789abcdef", name: "Bo", live: false, isSelf: false },
];

function setup(over: Partial<Parameters<typeof PeopleDialog>[0]> = {}) {
  const onRename = vi.fn();
  const onClose = vi.fn();
  render(
    <PeopleDialog
      open
      onClose={onClose}
      people={PEOPLE}
      name="You"
      onRename={onRename}
      maxBroadcasters={2}
      {...over}
    />,
  );
  return { onRename, onClose };
}

describe("PeopleDialog", () => {
  it("opens as a MODAL, not by setting the open attribute", () => {
    // Setting `open` directly gives a non-modal dialog with no backdrop, no focus
    // trap and no Escape — which looks identical in a screenshot and is not.
    setup();
    expect(window.HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("lists everyone, marking who is live and who is us", () => {
    setup();
    const rows = screen.getAllByTestId("person-row");
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.dataset.self === "true")).toHaveLength(1);
    expect(rows.filter((r) => r.dataset.live === "true")).toHaveLength(2);
    expect(screen.getByText(/You \(you\)/)).toBeTruthy();
  });

  it("disables Save until the name actually changes", async () => {
    // The guard matters: re-joining with an unchanged name is a wasted contract
    // call, and a Save button that is always enabled invites it.
    const user = userEvent.setup();
    const { onRename } = setup();
    const save = screen.getByTestId("username-submit") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.type(screen.getByTestId("username-input"), "!");
    expect(save.disabled).toBe(false);

    await user.click(save);
    expect(onRename).toHaveBeenCalledWith("You!");
  });

  it("treats a whitespace-only name as no change", async () => {
    const user = userEvent.setup();
    setup({ name: "Ana" });
    const input = screen.getByTestId("username-input");
    await user.clear(input);
    await user.type(input, "   ");
    expect(
      (screen.getByTestId("username-submit") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("trims the saved name", async () => {
    const user = userEvent.setup();
    const { onRename } = setup({ name: "" });
    await user.type(screen.getByTestId("username-input"), "  Ana  ");
    await user.click(screen.getByTestId("username-submit"));
    expect(onRename).toHaveBeenCalledWith("Ana");
  });

  it("saves on Enter as well as the button", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.type(screen.getByTestId("username-input"), "x{Enter}");
    expect(onRename).toHaveBeenCalledWith("Youx");
  });

  it("flags an unset name, and stops flagging it once saved", async () => {
    const user = userEvent.setup();
    setup({ name: "" });
    // The nudge exists because an unset name shows a placeholder on a tile that
    // everyone else can see.
    expect(screen.getByTestId("nickname-unset")).toBeTruthy();
    expect(screen.getByTestId("username-input").dataset.unset).toBe("true");

    await user.type(screen.getByTestId("username-input"), "Ana");
    await user.click(screen.getByTestId("username-submit"));
    expect(screen.getByTestId("nickname-saved")).toBeTruthy();
    expect(screen.queryByTestId("nickname-unset")).toBeNull();
  });

  it("clears the saved confirmation when editing resumes", async () => {
    // Otherwise "Saved" sits above a field holding something that is not saved.
    const user = userEvent.setup();
    setup({ name: "" });
    await user.type(screen.getByTestId("username-input"), "Ana");
    await user.click(screen.getByTestId("username-submit"));
    expect(screen.getByTestId("nickname-saved")).toBeTruthy();
    await user.type(screen.getByTestId("username-input"), "b");
    expect(screen.queryByTestId("nickname-saved")).toBeNull();
  });

  it("re-seeds the draft when reopened, dropping an abandoned edit", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          <PeopleDialog
            open={open}
            onClose={() => setOpen(false)}
            people={PEOPLE}
            name="You"
            onRename={vi.fn()}
            maxBroadcasters={2}
          />
        </>
      );
    }
    render(<Host />);
    const input = () =>
      screen.getByTestId("username-input") as HTMLInputElement;
    await user.clear(input());
    await user.type(input(), "abandoned");
    expect(input().value).toBe("abandoned");

    await user.click(screen.getByText("toggle")); // close
    await user.click(screen.getByText("toggle")); // reopen
    expect(input().value).toBe("You");
  });

  it("reports the live count against the cap", () => {
    setup();
    expect(screen.getByText(/2\/2 broadcasting/)).toBeTruthy();
  });

  it("says the roster is still loading rather than showing an empty list", () => {
    setup({ people: [] });
    expect(screen.queryByTestId("people-list")).toBeNull();
    expect(screen.getByText(/reading the roster/i)).toBeTruthy();
  });

  it("closes through close(), so React state and the element agree", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByTestId("people-dialog-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
