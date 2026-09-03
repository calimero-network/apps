/**
 * The bug report was a message, so these assert the message.
 *
 *     applicationId: expected 64 hex characters (32 bytes) at line 1 column 28
 *
 * came back from the node and named a JSON column. Each case below is a value a
 * user can plausibly end up holding, and the assertion is that the app says
 * which mistake it is before the request goes out.
 */
import { describe, expect, it } from "vitest";
import { HEX_ID, isHexId, requireHexId } from "./ids";

const GOOD = "3d16c53f9818c99962f6dff06459ed9d764c1d047728d65669ccbc46d01b36c5";

describe("HEX_ID / isHexId", () => {
  it("accepts 64 hex characters in either case", () => {
    expect(isHexId(GOOD)).toBe(true);
    expect(isHexId(GOOD.toUpperCase())).toBe(true);
    expect(HEX_ID.test(GOOD)).toBe(true);
  });

  it("tolerates surrounding whitespace, which a paste often carries", () => {
    expect(isHexId(`  ${GOOD}\n`)).toBe(true);
  });

  it("rejects 63 and 65 characters", () => {
    expect(isHexId(GOOD.slice(0, 63))).toBe(false);
    expect(isHexId(GOOD + "a")).toBe(false);
  });
});

describe("requireHexId", () => {
  it("returns the trimmed value when it is valid", () => {
    expect(requireHexId("applicationId", `  ${GOOD} `)).toBe(GOOD);
  });

  it("names the field, so the message lines up with the node's own", () => {
    expect(() => requireHexId("applicationId", "nope")).toThrow(
      /^applicationId must be 64 hex characters/,
    );
  });

  it("says an id copied from a truncated display is truncated", () => {
    // Exactly what the tables in this app render: 16 chars and an ellipsis.
    expect(() => requireHexId("applicationId", `${GOOD.slice(0, 16)}…`)).toThrow(
      /ellipsis|shortened/i,
    );
  });

  it("catches the ASCII three-dot form too", () => {
    expect(() =>
      requireHexId("applicationId", `${GOOD.slice(0, 16)}...`),
    ).toThrow(/ellipsis|shortened/i);
  });

  it("recognises a base58 id and says rc.27 removed it", () => {
    // A real base58 application id, the shape this app used to be given.
    expect(() =>
      requireHexId("applicationId", "46M9ayEPkpgDBoDDUP8bHJEwqCN78PXcndTUTW9crGc9"),
    ).toThrow(/base58/i);
  });

  it("reports the length when the value is hex but the wrong size", () => {
    expect(() => requireHexId("applicationId", GOOD.slice(0, 32))).toThrow(
      /32 characters long, not 64/,
    );
  });

  it("says so plainly when the field is empty", () => {
    expect(() => requireHexId("applicationId", "   ")).toThrow(/is empty/);
  });

  it("does not echo a long bad value in full", () => {
    const junk = "z".repeat(300);
    try {
      requireHexId("applicationId", junk);
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(junk);
      expect(msg.length).toBeLessThan(400);
    }
  });

  it("always points at where a real id comes from", () => {
    for (const bad of ["", "nope", `${GOOD.slice(0, 8)}…`, GOOD.slice(0, 40)]) {
      expect(() => requireHexId("applicationId", bad)).toThrow(/meroctl app ls/);
    }
  });
});
