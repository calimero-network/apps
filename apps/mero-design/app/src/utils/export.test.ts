import { describe, expect, it } from "vitest";
import { dataUrlToBytes, bytesToDataUrl, guessImageMime } from "./export";

describe("dataUrlToBytes", () => {
  it("decodes a simple base64 data URL", () => {
    // "Hello" in base64 is "SGVsbG8="
    const dataUrl = "data:text/plain;base64,SGVsbG8=";
    const bytes = dataUrlToBytes(dataUrl);
    expect(bytes).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
  });

  it("returns empty array for data URL with no base64 section", () => {
    const bytes = dataUrlToBytes("data:text/plain;base64,");
    expect(bytes).toEqual(new Uint8Array([]));
  });
});

describe("bytesToDataUrl", () => {
  it("returns a blob: URL string", () => {
    const bytes = [72, 101, 108, 108, 111];
    const url = bytesToDataUrl(bytes, "image/png");
    expect(url).toMatch(/^blob:/);
  });
});

describe("guessImageMime", () => {
  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.gif", "image/gif"],
    ["photo.webp", "image/webp"],
    ["icon.svg", "image/svg+xml"],
    ["file.unknown", "image/png"],
    ["noextension", "image/png"],
  ])("guesses mime for %s → %s", (filename, expected) => {
    expect(guessImageMime(filename)).toBe(expected);
  });
});
