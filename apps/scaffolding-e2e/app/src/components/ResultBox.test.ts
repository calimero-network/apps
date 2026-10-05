import { describe, expect, it } from "vitest";
import { decodeByteArrayErrors } from "./ResultBox";

const BODY = '{"data":"that key is frozen","kind":"Invalid"}';
const AS_TEXT = `the method call returned an error: ${BODY}`;
const AS_BYTES = `the method call returned an error: [${[...new TextEncoder().encode(BODY)].join(", ")}]`;

describe("decodeByteArrayErrors", () => {
  it("decodes the byte list an older node sends into its text", () => {
    expect(decodeByteArrayErrors(AS_BYTES)).toBe(AS_TEXT);
  });

  it("leaves the text core rc.81 sends as it is", () => {
    expect(decodeByteArrayErrors(AS_TEXT)).toBe(AS_TEXT);
  });

  it("shows the same thing whether the node sent text or bytes", () => {
    expect(decodeByteArrayErrors(AS_BYTES)).toBe(decodeByteArrayErrors(AS_TEXT));
  });

  it("does not mangle brackets inside an rc.81 text message", () => {
    const msg = 'the method call returned an error: "layer [3, 4] is locked"';
    expect(decodeByteArrayErrors(msg)).toBe(msg);
  });
});
