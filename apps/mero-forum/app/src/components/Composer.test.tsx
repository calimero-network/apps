/**
 * The composer's validation, moved down from the browser e2e.
 *
 * It used to be asserted at `/` with no node attached, which only worked
 * because the feed rendered unauthenticated — the state that produced the
 * reported FunctionCallError. Now that `/` is the explainer and the feed is
 * gated, that route cannot reach the composer, so the coverage lives here
 * instead of being dropped. It is pure UI logic and belongs at this level
 * anyway: the rules are "both fields non-blank" and "do not submit twice",
 * neither of which needs a browser or a contract.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Composer from "./Composer";

afterEach(cleanup);

// `fireEvent`, not `user-event`: the latter is not a dependency of this app and
// adding it would touch the workspace lockfile, which fans CI out to all
// sixteen apps for the sake of one test file. The composer opens on `focus` and
// reads `value`, so the two are equivalent here.

/** Expand the collapsed composer. */
function open() {
  fireEvent.focus(screen.getByLabelText("Start a discussion"));
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("Composer", () => {
  it("starts collapsed, so the feed is the first thing on the page", () => {
    render(<Composer onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Start a discussion")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post" })).not.toBeInTheDocument();
  });

  it("will not submit until BOTH fields have content", () => {
    render(<Composer onSubmit={vi.fn()} />);
    open();

    const post = screen.getByRole("button", { name: "Post" });
    // The contract rejects an empty title or body, and failing in the UI beats
    // a round trip to find that out.
    expect(post).toBeDisabled();

    type("Title", "Hello");
    expect(post).toBeDisabled();

    type("Text", "World");
    expect(post).toBeEnabled();
  });

  it("treats whitespace as empty", () => {
    render(<Composer onSubmit={vi.fn()} />);
    open();

    type("Title", "   ");
    type("Text", "   ");
    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
  });

  it("passes the title and body to onSubmit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Composer onSubmit={onSubmit} />);
    open();

    type("Title", "  Hello  ");
    type("Text", "  World  ");
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [title, body] = onSubmit.mock.calls[0];
    expect(title.trim()).toBe("Hello");
    expect(body.trim()).toBe("World");
  });

  it("surfaces a rejection instead of swallowing it", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("not connected to a node"));
    render(<Composer onSubmit={onSubmit} />);
    open();

    type("Title", "Hello");
    type("Text", "World");
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText(/not connected to a node/i)).toBeInTheDocument();
  });

  it("collapses back to the one-line form on Cancel", () => {
    render(<Composer onSubmit={vi.fn()} />);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Start a discussion")).toBeInTheDocument();
  });
});
