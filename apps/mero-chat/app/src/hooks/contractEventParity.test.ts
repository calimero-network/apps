import { describe, expect, it } from "vitest";

// `?raw` rather than `node:fs`: this runs under Vite, the paths resolve the same
// way the app's own imports do, and it needs no Node type definitions.
import contractSource from "../../../logic/src/lib.rs?raw";
import handlersSource from "./useChatHandlers.ts?raw";

/**
 * The contract and this client share an event vocabulary and, until this test,
 * shared no definition of it. Events are an enum on one side and string literals
 * on the other, so a rename or a removal on either side is silent: a `case` arm
 * for an event nobody emits compiles, passes review, and is covered by tests
 * that construct the event by hand.
 *
 * That is not hypothetical. `db54a73` ("remove redundant events", 2025-10-09)
 * deleted variants from the contract and touched nothing here, leaving thirteen
 * dead arms for about ten months — including every trigger for refreshing the DM
 * list, which therefore stopped refreshing at all. Nothing failed. The only
 * symptom was a DM that needed a reload to appear, which reads as flakiness.
 *
 * Read from the contract SOURCE rather than the generated ABI on purpose:
 * `logic/res/` is gitignored, so `abi.json` is absent on a clean checkout and in
 * frontend CI, and a guard that silently skips is not a guard.
 */

/**
 * Events this client handles that the CONTRACT does not emit, with the reason.
 *
 * An entry here is a claim that something other than the app's own `app::emit!`
 * produces it. Anything else belongs in the switch only if the contract emits
 * it, and the test says so.
 */
const NOT_FROM_THE_CONTRACT: Record<string, string> = {};

function contractEvents(): string[] {
  const src = contractSource;
  const block = /pub enum Event\s*\{([\s\S]*?)\n\}/.exec(src);
  if (!block) {
    throw new Error(
      "could not find `pub enum Event` in the contract — this guard is now blind, " +
        "which is worse than it failing. Fix the parse rather than deleting the test.",
    );
  }
  const names = [...block[1].matchAll(/^\s{4}([A-Z][A-Za-z0-9]*)\s*[({,]/gm)].map(
    (m) => m[1],
  );
  if (names.length === 0) {
    throw new Error("parsed `enum Event` but found no variants — see above");
  }
  return names.sort();
}

function handledEvents(): string[] {
  const src = handlersSource;
  return [...src.matchAll(/case "([A-Za-z0-9]+)":/g)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
}

describe("contract/client event parity", () => {
  it("handles every event the contract emits", () => {
    const emitted = contractEvents();
    const handled = new Set(handledEvents());
    const unhandled = emitted.filter((e) => !handled.has(e));

    expect(
      unhandled,
      "the contract emits these and nothing here listens, so the change they " +
        "announce never reaches the UI",
    ).toEqual([]);
  });

  it("handles nothing the contract cannot emit", () => {
    const emitted = new Set(contractEvents());
    const dead = handledEvents().filter(
      (e) => !emitted.has(e) && !(e in NOT_FROM_THE_CONTRACT),
    );

    expect(
      dead,
      "these arms cannot ever run: the contract has no such variant. Either the " +
        "contract should emit it, or the arm should go — a dead arm is worse " +
        "than a missing one, because it looks like the case is handled",
    ).toEqual([]);
  });

  it("can actually see both sides", () => {
    // A parse that silently returns nothing would make both assertions above
    // pass forever.
    expect(contractEvents().length).toBeGreaterThan(3);
    expect(handledEvents().length).toBeGreaterThan(3);
  });
});
