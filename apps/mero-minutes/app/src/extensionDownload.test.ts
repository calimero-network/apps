// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extensionVersion, zipExtension } from "../extensionDownload";

describe("the extension download", () => {
  it("zips the built extension under one minutes/ folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-ext-"));
    mkdirSync(join(dir, "dist", "icons"), { recursive: true });
    writeFileSync(join(dir, "dist", "manifest.json"), '{"name":"Minutes"}');
    writeFileSync(join(dir, "dist", "icons", "icon-16.png"), "png");
    writeFileSync(join(dir, "package.json"), '{"version":"0.3.1"}');
    const files = unzipSync(zipExtension(join(dir, "dist")));
    expect(Object.keys(files).sort()).toEqual(["minutes/icons/icon-16.png", "minutes/manifest.json"]);
    expect(new TextDecoder().decode(files["minutes/manifest.json"])).toBe('{"name":"Minutes"}');
    expect(extensionVersion(dir)).toBe("0.3.1");
  });

  it("refuses a folder with no built extension", () => {
    expect(() => zipExtension(mkdtempSync(join(tmpdir(), "mm-empty-")))).toThrow(/no built extension/);
  });
});
