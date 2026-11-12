import { describe, expect, it } from "vitest";
import {
  CI_ASYNC_UTIL_TIMEOUT_MS,
  LOCAL_ASYNC_UTIL_TIMEOUT_MS,
  asyncUtilTimeoutFor,
  configuredAsyncUtilTimeout,
  isCi,
} from "./index";

describe("asyncUtilTimeoutFor", () => {
  it("keeps Testing Library's 1 s default off CI", () => {
    expect(LOCAL_ASYNC_UTIL_TIMEOUT_MS).toBe(1000);
    expect(asyncUtilTimeoutFor({})).toBe(1000);
    expect(asyncUtilTimeoutFor({ CI: "" })).toBe(1000);
    expect(asyncUtilTimeoutFor({ CI: "false" })).toBe(1000);
    expect(asyncUtilTimeoutFor({ CI: "0" })).toBe(1000);
  });

  it("waits 5 s on CI", () => {
    expect(CI_ASYNC_UTIL_TIMEOUT_MS).toBe(5000);
    expect(asyncUtilTimeoutFor({ CI: "true" })).toBe(5000);
    expect(asyncUtilTimeoutFor({ CI: "1" })).toBe(5000);
    expect(isCi({ CI: "TRUE" })).toBe(true);
  });
});

describe("importing the module", () => {
  // The same check against this process's env, so a CI run of this suite
  // proves the CI wait is applied and a local run proves the default is kept.
  it("configures Testing Library for this process's env", () => {
    expect(configuredAsyncUtilTimeout()).toBe(
      asyncUtilTimeoutFor(process.env),
    );
  });
});
