import { describe, expect, it } from "vitest";
import { notificationPreview, toPlainText } from "./plainText";

describe("toPlainText", () => {
  it("strips the tags the OS banner was rendering verbatim", () => {
    expect(toPlainText("<p>hello <strong>there</strong></p>")).toBe(
      "hello there",
    );
  });

  it("treats block boundaries as spaces so words do not run together", () => {
    expect(toPlainText("<p>one</p><p>two</p>")).toBe("one two");
    expect(toPlainText("a<br>b")).toBe("a b");
  });

  it("decodes entities", () => {
    expect(toPlainText("<p>a &amp; b &lt;c&gt;</p>")).toBe("a & b <c>");
    expect(toPlainText("a&nbsp;b")).toBe("a b");
  });

  it("collapses whitespace and trims", () => {
    expect(toPlainText("<p>  spaced   out  </p>")).toBe("spaced out");
  });

  it("handles empty and plain input", () => {
    expect(toPlainText("")).toBe("");
    expect(toPlainText("just text")).toBe("just text");
  });
});

describe("notificationPreview", () => {
  it("truncates AFTER flattening, so the cut never lands mid-tag", () => {
    const html = `<p>${"a".repeat(150)}</p>`;
    const preview = notificationPreview(html);
    expect(preview).toBe(`${"a".repeat(100)}...`);
    expect(preview).not.toContain("<");
  });

  it("leaves short messages untouched", () => {
    expect(notificationPreview("<p>short</p>")).toBe("short");
  });
});
