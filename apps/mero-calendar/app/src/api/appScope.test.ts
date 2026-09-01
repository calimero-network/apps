import { describe, expect, it } from "vitest";

import {
  contextAppId,
  contextId,
  contextsForThisApp,
  namespaceAppId,
  namespaceId,
  namespacesForThisApp,
  type ContextRecord,
  type NamespaceRecord,
} from "./appScope";

const CALENDAR = "CalendarAppId1111111111111111111111111111111";
const OTHER_APP = "SomeOtherAppId22222222222222222222222222222";

/** A namespace the way core's `/namespaces` handlers actually serialize one. */
function ns(
  targetApplicationId: string,
  overrides: Partial<NamespaceRecord> = {},
): NamespaceRecord {
  return {
    namespaceId: "ns-1",
    name: "Design",
    targetApplicationId,
    contextCount: 1,
    memberCount: 2,
    ...overrides,
  };
}

/** A context the way `ContextWithGroup` serializes one. */
function ctx(
  applicationId: string,
  overrides: Partial<ContextRecord> = {},
): ContextRecord {
  return { id: "ctx-1", applicationId, groupId: "grp-1", ...overrides };
}

describe("reading ids out of core's records", () => {
  it("reads a namespace's target application from any casing core has used", () => {
    expect(namespaceAppId(ns(CALENDAR))).toBe(CALENDAR);
    expect(
      namespaceAppId({ target_application_id: CALENDAR } as NamespaceRecord),
    ).toBe(CALENDAR);
    expect(namespaceAppId({ applicationId: CALENDAR })).toBe(CALENDAR);
  });

  it("reads a context's application from either casing", () => {
    expect(contextAppId(ctx(CALENDAR))).toBe(CALENDAR);
    expect(contextAppId({ application_id: CALENDAR })).toBe(CALENDAR);
  });

  it("returns an empty string rather than undefined when the field is absent", () => {
    expect(namespaceAppId({})).toBe("");
    expect(contextAppId({})).toBe("");
  });

  it("prefers namespaceId, then groupId, then id", () => {
    expect(namespaceId({ namespaceId: "a", groupId: "b", id: "c" })).toBe("a");
    expect(namespaceId({ groupId: "b", id: "c" })).toBe("b");
    expect(namespaceId({ id: "c" })).toBe("c");
    expect(namespaceId({})).toBe("");
  });

  it("prefers contextId, then context_id, then id", () => {
    expect(contextId({ contextId: "a", context_id: "b", id: "c" })).toBe("a");
    expect(contextId({ context_id: "b", id: "c" })).toBe("b");
    expect(contextId({ id: "c" })).toBe("c");
  });

  it("trims ids, so a padded value still matches", () => {
    expect(namespaceAppId(ns(` ${CALENDAR} `))).toBe(CALENDAR);
    expect(namespaceId({ namespaceId: " ns-9 " })).toBe("ns-9");
  });
});

describe("scoping namespaces to this application", () => {
  it("keeps only the namespaces targeting Mero Calendar", () => {
    const all = [
      ns(CALENDAR, { namespaceId: "mine" }),
      ns(OTHER_APP, { namespaceId: "theirs" }),
      ns(CALENDAR, { namespaceId: "mine-2" }),
    ];
    expect(
      namespacesForThisApp(all, CALENDAR).map((n) => n.namespaceId),
    ).toEqual(["mine", "mine-2"]);
  });

  // The whole point of the module. Falling back to "show everything" is what
  // made another application's namespaces look like teams, and opening one
  // dead-ends on a 500 that never mentions applications.
  it("returns NOTHING when this application's id is unknown", () => {
    const all = [ns(CALENDAR), ns(OTHER_APP)];
    expect(namespacesForThisApp(all, undefined)).toEqual([]);
    expect(namespacesForThisApp(all, "")).toEqual([]);
    expect(namespacesForThisApp(all, "   ")).toEqual([]);
  });

  it("drops a namespace that names no application at all", () => {
    const all = [ns(CALENDAR, { namespaceId: "mine" }), { namespaceId: "mystery" }];
    expect(
      namespacesForThisApp(all, CALENDAR).map((n) => n.namespaceId),
    ).toEqual(["mine"]);
  });

  it("does not match on a prefix", () => {
    expect(namespacesForThisApp([ns(CALENDAR)], CALENDAR.slice(0, 20))).toEqual(
      [],
    );
  });

  it("tolerates a padded application id from the session", () => {
    expect(namespacesForThisApp([ns(CALENDAR)], ` ${CALENDAR} `)).toHaveLength(
      1,
    );
  });
});

describe("scoping contexts to this application", () => {
  it("keeps only the contexts running Mero Calendar", () => {
    const all = [
      ctx(CALENDAR, { id: "cal-a" }),
      ctx(OTHER_APP, { id: "kv-a" }),
      ctx(CALENDAR, { id: "cal-b" }),
    ];
    expect(contextsForThisApp(all, CALENDAR).map((c) => c.id)).toEqual([
      "cal-a",
      "cal-b",
    ]);
  });

  it("returns NOTHING when this application's id is unknown", () => {
    const all = [ctx(CALENDAR), ctx(OTHER_APP)];
    expect(contextsForThisApp(all, undefined)).toEqual([]);
    expect(contextsForThisApp(all, "")).toEqual([]);
  });

  it("drops a context that names no application", () => {
    const all = [ctx(CALENDAR, { id: "cal-a" }), { id: "mystery" }];
    expect(contextsForThisApp(all, CALENDAR).map((c) => c.id)).toEqual([
      "cal-a",
    ]);
  });

  it("handles an empty list without inventing entries", () => {
    expect(contextsForThisApp([], CALENDAR)).toEqual([]);
    expect(namespacesForThisApp([], CALENDAR)).toEqual([]);
  });
});
