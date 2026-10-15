import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./Input";

describe("Input", () => {
  // mero-ui's Input paints its text #FFFFFF inline, which is invisible on the
  // chat's light surfaces (the Create workspace name field showed nothing).
  it("draws typed text in the theme's ink colour, not mero-ui's white", () => {
    render(<Input value="Calimero" onChange={() => {}} />);
    const input = screen.getByDisplayValue("Calimero");
    expect(input.style.color).toBe("var(--glass-ink)");
  });

  it("keeps a colour the caller passes", () => {
    render(<Input value="x" onChange={() => {}} style={{ color: "red" }} />);
    expect(screen.getByDisplayValue("x").style.color).toBe("red");
  });
});
