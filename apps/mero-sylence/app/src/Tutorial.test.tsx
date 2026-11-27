import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tutorial, tutorialSeen } from "./Tutorial";

describe("Tutorial", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("steps forward and back, jumps by dot, and is seen once closed", () => {
    const onClose = vi.fn();
    expect(tutorialSeen()).toBe(false);
    render(<Tutorial open onClose={onClose} />);
    expect(screen.getByText("Step 1 of 6")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back/ })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("heading", { name: "Sign in and pick a workspace" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByText("Step 1 of 6")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Step 6/ }));
    expect(screen.getByRole("heading", { name: "Act on it together" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(onClose).toHaveBeenCalled();
    expect(tutorialSeen()).toBe(true);
  });

  it("follows the arrow keys", () => {
    render(<Tutorial open onClose={() => {}} />);
    fireEvent.keyDown(screen.getByTestId("tutorial"), { key: "ArrowRight" });
    expect(screen.getByText("Step 2 of 6")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("tutorial"), { key: "ArrowLeft" });
    expect(screen.getByText("Step 1 of 6")).toBeTruthy();
  });
});
