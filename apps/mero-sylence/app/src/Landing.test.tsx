import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Landing } from "./Landing";

afterEach(cleanup);

describe("the front door", () => {
  it("offers to create an account, and to sign in, both opening the passkey panel", () => {
    const onSignIn = vi.fn();
    render(<Landing onSignIn={onSignIn} onInstall={() => {}} />);
    const create = screen.getAllByRole("button", { name: "Create an account" });
    expect(create.length).toBeGreaterThan(0);
    fireEvent.click(create[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]!);
    expect(onSignIn).toHaveBeenCalledTimes(2);
  });
});
