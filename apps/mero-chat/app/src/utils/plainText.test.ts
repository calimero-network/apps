import { describe, expect, it } from "vitest";
import { notificationBody, notificationPreview, toPlainText } from "./plainText";

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

describe("notificationBody", () => {
  const image = { name: "a.png" };
  const file = { name: "a.pdf" };

  it("uses the text when there is any", () => {
    expect(
      notificationBody({ text: "<p>hi</p>", images: [image], files: [] }, "Alice"),
    ).toBe("<p>hi</p>");
  });

  it("says who sent an image when the message is only an image", () => {
    expect(notificationBody({ text: "", images: [image], files: [] }, "Alice")).toBe(
      "Alice sent an image",
    );
  });

  it("says who sent a file when the message is only a file", () => {
    expect(notificationBody({ text: "", images: [], files: [file] }, "Alice")).toBe(
      "Alice sent a file",
    );
  });

  it("names both when the message carries both", () => {
    expect(
      notificationBody({ text: "", images: [image], files: [file] }, "Alice"),
    ).toBe("Alice sent an image and a file");
  });

  it("treats text that flattens to nothing as no text", () => {
    expect(
      notificationBody({ text: "<p><br></p>", images: [image], files: [] }, "Alice"),
    ).toBe("Alice sent an image");
  });

  it("has nothing to say about a message with neither", () => {
    expect(notificationBody({ text: "", images: [], files: [] }, "Alice")).toBe("");
    expect(notificationBody({}, "Alice")).toBe("");
  });

  it("falls back when the sender has no resolved name", () => {
    expect(notificationBody({ images: [image] }, "")).toBe("Someone sent an image");
  });
});
