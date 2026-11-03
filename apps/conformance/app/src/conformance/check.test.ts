import { AppError, CalimeroError, ConfirmRequired, LoginRequired, NotFound, TrapError } from "@calimero-network/mero-js";
import { describe, expect, it } from "vitest";

import { Blocked, Mismatch, OK, appError, check, classify, need } from "./check";
import type { Row } from "./types";

describe("classify", () => {
  it("names an app's refusal by its code", () => {
    const e = new AppError("refused", { code: "NotAWriter", fields: { account: "a" } });
    expect(classify(e).actual).toBe(appError(e.appCode));
  });
  it("names a trap, and every node refusal by its API code", () => {
    expect(classify(new TrapError("trapped", { kind: "Fault" })).actual).toBe("TRAP");
    expect(classify(new NotFound("no such app")).actual).toBe("NOT_FOUND");
    expect(classify(new ConfirmRequired("approve")).actual).toBe("CONFIRM_REQUIRED");
    expect(classify(new LoginRequired("sign in")).actual).toBe("UNAUTHENTICATED");
    expect(classify(new CalimeroError(400, "NO_REGISTRY", "none")).actual).toBe("NO_REGISTRY");
  });
  it("forgives nothing else", () => {
    expect(classify(new Error("boom")).actual).toBe("error");
    expect(classify(new TypeError("fetch failed")).actual).toBe("error");
    expect(classify(new Mismatch("read x")).actual).toBe("mismatch");
    expect(classify(new Blocked("needs y")).actual).toBe("blocked");
  });
});

describe("check", () => {
  const rows: Row[] = [];
  const rec = { record: (r: Row) => rows.push(r) };

  it("passes a row only when what happened is what it expects", async () => {
    rows.length = 0;
    expect(await check(rec, "A", "Area", "fine", OK, () => Promise.resolve(42), (v) => v)).toBe(42);
    expect(await check(rec, "B", "Area", "refused as expected", "NOT_FOUND", () => Promise.reject(new NotFound("x")))).toBeUndefined();
    expect(await check(rec, "B", "Area", "refused, expected ok", OK, () => Promise.reject(new NotFound("x")))).toBeUndefined();
    // A call that resolved hands its value on, whatever the row expected.
    expect(await check(rec, "A", "Area", "ok, expected a refusal", "FORBIDDEN", () => Promise.resolve(1))).toBe(1);
    expect(rows.map((r) => [r.name, r.pass, r.actual])).toEqual([
      ["Area / fine", true, OK],
      ["Area / refused as expected", true, "NOT_FOUND"],
      ["Area / refused, expected ok", false, "NOT_FOUND"],
      ["Area / ok, expected a refusal", false, OK],
    ]);
    expect(rows[0]?.detail).toBe("42");
  });

  it("reports a row whose input an earlier row did not produce as blocked", async () => {
    rows.length = 0;
    await check(rec, "A", "Area", "needs", OK, async () => need(undefined as string | undefined, "an org"));
    expect(rows[0]).toMatchObject({ actual: "blocked", pass: false });
    expect(rows[0]?.error).toMatch(/needs an org/);
  });
});
