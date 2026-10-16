import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("shows initials for a chosen name", () => {
    const { container } = render(<Avatar name="Ana Marija" />);
    expect(container).toHaveTextContent("AM");
    expect(container.querySelector("svg")).toBeNull();
  });

  // A nameless member is shown as `3e76…db86`; its "3" read as a member count.
  it.each(["3e76…db86", "3e76...db86", "Unnamed member"])(
    "shows the person glyph, not a character, for %j",
    (name) => {
      const { container } = render(<Avatar name={name} />);
      expect(container.textContent).toBe("");
      expect(container.querySelector("svg")).not.toBeNull();
    },
  );
});
