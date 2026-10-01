import { describe, expect, it } from "vitest";
import { attachmentKindFor, dragCarriesFiles } from "./attachmentKind";

describe("attachmentKindFor", () => {
  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["loop.gif", "image/gif"],
  ])("puts %s (%s) in the image slot", (name, type) => {
    expect(attachmentKindFor({ name, type })).toBe("image");
  });

  it.each([
    ["contract.pdf", "application/pdf"],
    [
      "report.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["legacy.doc", "application/msword"],
    ["notes.txt", "text/plain"],
    ["archive.zip", "application/zip"],
  ])("puts %s (%s) in the file slot", (name, type) => {
    expect(attachmentKindFor({ name, type })).toBe("file");
  });

  // The image slot renders inline, and only these three are what the image
  // picker accepts. An SVG or HEIC still travels, as a file.
  it.each([
    ["diagram.svg", "image/svg+xml"],
    ["iphone.heic", "image/heic"],
  ])("sends %s (%s), an image type the image slot does not take, as a file", (name, type) => {
    expect(attachmentKindFor({ name, type })).toBe("file");
  });

  it("falls back to the extension when the OS supplies no type", () => {
    expect(attachmentKindFor({ name: "Screenshot.PNG", type: "" })).toBe("image");
    expect(attachmentKindFor({ name: "photo.jpeg", type: "" })).toBe("image");
    expect(attachmentKindFor({ name: "notes.txt", type: "" })).toBe("file");
    expect(attachmentKindFor({ name: "README", type: "" })).toBe("file");
  });

  it("trusts a present type over the extension", () => {
    expect(attachmentKindFor({ name: "not-really.png", type: "application/pdf" })).toBe(
      "file",
    );
  });
});

describe("dragCarriesFiles", () => {
  const withTypes = (types: string[]) => ({ types }) as unknown as DataTransfer;

  it("is true for a file drag", () => {
    expect(dragCarriesFiles(withTypes(["Files"]))).toBe(true);
  });

  it("is false for dragged text or a link, so the editor keeps its own drop", () => {
    expect(dragCarriesFiles(withTypes(["text/plain", "text/html"]))).toBe(false);
    expect(dragCarriesFiles(withTypes(["text/uri-list"]))).toBe(false);
  });

  it("is false with no DataTransfer at all", () => {
    expect(dragCarriesFiles(null)).toBe(false);
  });
});
