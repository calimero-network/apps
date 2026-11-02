import { AppError, ConfirmRequired, LoginRequired, NotFound, TrapError } from "@calimero-network/mero-js";
import { describe, expect, it } from "vitest";

import { accounts, canonical, check, substitute, unsupported, type Step } from "./scenario.ts";
import { SoftPasskey } from "./soft-passkey.ts";

const appError = (code: string, fields: Record<string, unknown> = {}) => new AppError("app error", { code, fields });

describe("check", () => {
  it("compares an ok result by content, keys in any order", () => {
    check({ ok: { a: "1", b: "2" } }, { ok: true, value: { b: "2", a: "1" } });
    check({ ok: null }, { ok: true, value: null });
    expect(() => check({ ok: "first" }, { ok: true, value: "second" })).toThrow(/expected ok "first", got ok "second"/);
    expect(() => check({ ok: "x" }, { ok: false, error: appError("NotFound") })).toThrow(/expected ok/);
  });

  it("requires success when nothing is expected", () => {
    check(undefined, { ok: true, value: 1 });
    expect(() => check(undefined, { ok: false, error: new LoginRequired("x") })).toThrow(/expected success/);
  });

  it("matches an app error by code, and its fields exactly when given", () => {
    check({ error: "NotFound" }, { ok: false, error: appError("NotFound", { key: "k" }) });
    check({ error: "NotFound", fields: { key: "k" } }, { ok: false, error: appError("NotFound", { key: "k" }) });
    expect(() =>
      check({ error: "NotFound", fields: { key: "x" } }, { ok: false, error: appError("NotFound", { key: "k" }) }),
    ).toThrow(/NotFound \{"key":"x"\}/);
    expect(() => check({ error: "Forbidden" }, { ok: false, error: appError("NotFound") })).toThrow();
    expect(() => check({ error: "NotFound" }, { ok: true, value: null })).toThrow();
  });

  it("matches a trap, its kind loosely when the node names one", () => {
    check({ trap: "Panic" }, { ok: false, error: new TrapError("trap", {}) });
    check({ trap: "OutOfFuel" }, { ok: false, error: new TrapError("trap", { kind: "out_of_fuel" }) });
    expect(() => check({ trap: "OutOfFuel" }, { ok: false, error: new TrapError("trap", { kind: "Panic" }) })).toThrow();
    expect(() => check({ trap: "Panic" }, { ok: false, error: appError("NotFound") })).toThrow();
  });

  it("matches a refusal by the node's code, and a step-up", () => {
    check({ refused: "UNAUTHENTICATED" }, { ok: false, error: new LoginRequired("x") });
    check({ refused: "NOT_FOUND" }, { ok: false, error: new NotFound("x") });
    check({ confirmRequired: true }, { ok: false, error: new ConfirmRequired("x") });
    expect(() => check({ refused: "NOT_FOUND" }, { ok: false, error: new LoginRequired("x") })).toThrow();
  });
});

describe("substitute", () => {
  const ids = (name: string) => `id-of-${name}`;

  it("replaces exact $vars and @accounts, nested, and leaves other strings", () => {
    const vars = new Map<string, unknown>([["room", { id: 7 }]]);
    expect(substitute({ a: "$room", b: ["@bob", "$5 lunch", "@", "x@bob"] }, vars, ids)).toEqual({
      a: { id: 7 },
      b: ["id-of-bob", "$5 lunch", "@", "x@bob"],
    });
  });

  it("refuses an unknown variable", () => {
    expect(() => substitute("$nope", new Map(), ids)).toThrow(/unknown variable \$nope/);
  });
});

describe("accounts", () => {
  it("lists the owner, the org file's accounts and every account the steps name", () => {
    const steps: Step[] = [
      { as: "bob", op: "call", method: "set", args: { to: "@carol" } },
      { as: "@anonymous", op: "view", method: "get" },
      { op: "view", method: "get", events: { dave: [] } },
    ];
    expect(accounts(steps, { members: ["bob"], outsiders: ["mallory"] })).toEqual([
      "owner",
      "bob",
      "mallory",
      "carol",
      "dave",
    ]);
  });
});

describe("unsupported", () => {
  it("skips what only the harness can do", () => {
    expect(unsupported([{ op: "call", method: "set" }], {})).toBeNull();
    expect(unsupported([{ op: "tick", method: "sweep" }], {})).toMatch(/timer/);
    expect(unsupported([{ op: "advance", args: 1000 }], {})).toMatch(/clock/);
    expect(unsupported([{ as: "@system", op: "call", method: "x" }], {})).toMatch(/system/);
    expect(unsupported([], { teams: { t: ["bob"] } })).toMatch(/teams/);
  });
});

describe("canonical", () => {
  it("sorts keys at every depth", () => {
    expect(canonical({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  });
});

describe("SoftPasskey", () => {
  it("registers, then signs an assertion over the challenge for its rp", async () => {
    const passkey = new SoftPasskey("localhost", "http://localhost:5173");
    await expect(passkey.get(new Uint8Array(32))).rejects.toThrow(/not been registered/);
    const registration = await passkey.create({ challenge: "AAAA" });
    expect(typeof registration.attestationObject).toBe("string");
    const assertion = await passkey.get(new Uint8Array([1, 2, 3]));
    expect(assertion.credentialId).toBe(passkey.id);
    const clientData = JSON.parse(atob(assertion.clientDataJson.replace(/-/g, "+").replace(/_/g, "/")));
    expect(clientData).toMatchObject({ type: "webauthn.get", origin: "http://localhost:5173" });
  });
});
