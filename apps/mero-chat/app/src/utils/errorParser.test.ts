import { describe, expect, it } from "vitest";
import { extractErrorMessage, parseErrorMessage } from "./errorParser";

const BODY = '"you are not a member of this channel"';
const AS_TEXT = `the method call returned an error: ${BODY}`;
const AS_BYTES = `the method call returned an error: [${[...new TextEncoder().encode(BODY)].join(", ")}]`;

describe("parseErrorMessage", () => {
  it("decodes the byte list an older node sends", () => {
    expect(parseErrorMessage(AS_BYTES)).toBe(BODY);
  });

  it("reads the text core rc.81 sends", () => {
    expect(parseErrorMessage(AS_TEXT)).toBe(BODY);
  });

  it("reads the same message whether the node sent text or bytes", () => {
    expect(parseErrorMessage(AS_TEXT)).toBe(parseErrorMessage(AS_BYTES));
  });

  it("does not mistake a number list inside an rc.81 text message for bytes", () => {
    expect(
      parseErrorMessage(
        'the method call returned an error: "seat [3, 4] is taken"',
      ),
    ).toBe('"seat [3, 4] is taken"');
  });

  it("still decodes a bare byte array and a byte list without the prefix", () => {
    const bytes = [...new TextEncoder().encode("hi")];
    expect(parseErrorMessage(bytes)).toBe("hi");
    expect(parseErrorMessage(`err: [${bytes.join(", ")}]`)).toBe("hi");
  });

  it("leaves a plain message alone", () => {
    expect(parseErrorMessage("boom")).toBe("boom");
  });
});

describe("extractErrorMessage", () => {
  it("reads the message off an error object in either shape", () => {
    expect(extractErrorMessage({ message: AS_TEXT })).toBe(BODY);
    expect(extractErrorMessage({ error: AS_BYTES })).toBe(BODY);
  });
});
