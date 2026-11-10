import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

const members: Record<string, Array<{ identity: string; alias?: string }>> = {
  "ws-1": [{ identity: "acc-1", alias: "Fran" }],
  "ws-2": [{ identity: "acc-1", alias: "Sandi" }],
};

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    listMembers = vi.fn(async (ns: string) => ({ data: { members: members[ns] ?? [] }, error: null }));
  },
}));

// The session module pulls in the app's whole workspace graph (and through it
// this repository's own singleton); the account is all this test needs.
vi.mock("../../api/calimero", () => ({ getAccountId: () => "acc-1" }));

import { NameRepository } from "./NameRepository";

describe("NameRepository", () => {
  it("names one account by the workspace it is seen in", async () => {
    let current = "ws-1";
    const names = new NameRepository(() => current);

    names.displayName("acc-1"); // schedules the fetch, as a render does
    await vi.waitFor(() => expect(names.displayName("acc-1")).toBe("Fran"));

    current = "ws-2";
    // Not W1's cached name: this workspace's own.
    expect(names.peek("acc-1")).toBeUndefined();
    names.displayName("acc-1");
    await vi.waitFor(() => expect(names.displayName("acc-1")).toBe("Sandi"));

    current = "ws-1";
    expect(names.peek("acc-1")).toBe("Fran");
  });
});
