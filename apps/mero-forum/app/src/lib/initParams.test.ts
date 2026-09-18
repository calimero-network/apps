import { describe, expect, it } from "vitest";

import abi from "../../../logic/res/abi.json";

/**
 * The create path sends `initializationParams` to the contract's `init`, and a
 * surplus field is not ignored — it panics inside the guest:
 *
 *     HTTP 400: application initialization failed: guest panicked:
 *     init: takes no arguments, but the call sent unknown field(s): ["name"]
 *
 * That happened because this module was ported from mero-stream, whose
 * `init(name: String)` does take one. Nothing compared the payload to this
 * contract's actual signature, so the mismatch only showed up as a 400 at the
 * moment someone tried to create a forum.
 *
 * This reads the committed ABI — the same file the typed client is generated
 * from — so if `init` ever gains a parameter, this fails and names the payload
 * that has to change with it.
 */
describe("init parameters match the contract", () => {
  const methods =
    (abi as { methods?: { name: string; params?: unknown[] }[] }).methods ?? [];
  const init = methods.find((m) => m.name === "init");

  it("the ABI still has an init", () => {
    expect(init).toBeDefined();
  });

  it("init takes NO arguments, so the create path must send none", () => {
    expect(init?.params ?? []).toHaveLength(0);
  });
});
