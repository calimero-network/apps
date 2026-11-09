import { describe, expect, it } from "vitest";
import { rpcErrorMessage } from "./errorMessage";

describe("rpcErrorMessage", () => {
  it("reads the nested node message", () => {
    expect(
      rpcErrorMessage({
        error: {
          code: 1,
          message: "outer",
          error: { cause: { info: { message: "inner" } } },
        },
      }),
    ).toBe("inner");
  });

  it("falls back to error.message when cause or info is missing", () => {
    expect(
      rpcErrorMessage({ error: { code: 1, message: "outer", error: {} } }),
    ).toBe("outer");
    expect(
      rpcErrorMessage({
        error: { code: 1, message: "outer", error: { cause: {} } },
      }),
    ).toBe("outer");
    expect(rpcErrorMessage({ error: { code: 1, message: "outer" } })).toBe(
      "outer",
    );
  });

  it("falls back to the status text, then a generic message", () => {
    expect(
      rpcErrorMessage({
        error: { code: 503, statusText: "Service Unavailable" },
      }),
    ).toBe("Service Unavailable");
    expect(rpcErrorMessage({ error: { code: 500 } })).toBe(
      "The request failed.",
    );
    expect(rpcErrorMessage(undefined)).toBe("The request failed.");
  });
});
