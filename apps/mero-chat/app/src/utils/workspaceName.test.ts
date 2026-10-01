import { describe, expect, it } from "vitest";

import { resolveWorkspaceName } from "./workspaceName";

describe("resolveWorkspaceName", () => {
  it("prefers the replicated metadata name", () => {
    // Metadata is the only source everyone in the workspace shares. A local
    // alias is one browser's label, so it must not shadow the shared name —
    // otherwise two members see different names for the same workspace.
    expect(
      resolveWorkspaceName({
        metadataName: "Calimero",
        serverAlias: "stale",
        localAlias: "my old label",
        groupId: "1252d374abcdef",
      }),
    ).toBe("Calimero");
  });

  it("falls back to the local alias when metadata has no name", () => {
    // Every workspace named before this shipped has only a local alias. It
    // must keep working, or shipping the fix erases names people already set.
    expect(
      resolveWorkspaceName({
        metadataName: null,
        serverAlias: undefined,
        localAlias: "Calimero",
        groupId: "1252d374abcdef",
      }),
    ).toBe("Calimero");
  });

  it("falls back to a truncated id when nothing has named it", () => {
    expect(
      resolveWorkspaceName({
        metadataName: null,
        serverAlias: undefined,
        localAlias: "",
        groupId: "1252d374abcdef",
      }),
    ).toBe("1252d374…");
  });

  it("ignores whitespace-only names at every level", () => {
    expect(
      resolveWorkspaceName({
        metadataName: "   ",
        serverAlias: "  ",
        localAlias: "Calimero",
        groupId: "1252d374abcdef",
      }),
    ).toBe("Calimero");
  });

  it("says Workspace when there is not even an id", () => {
    expect(
      resolveWorkspaceName({
        metadataName: null,
        serverAlias: undefined,
        localAlias: "",
        groupId: "",
      }),
    ).toBe("Workspace");
  });

  it("reports whether the shared name is missing, so a local one can be backfilled", () => {
    // The caller uses this to promote a local alias into metadata once, so a
    // name set before this shipped becomes visible to everyone else.
    expect(
      resolveWorkspaceName({
        metadataName: null,
        serverAlias: undefined,
        localAlias: "Calimero",
        groupId: "g",
      }),
    ).toBe("Calimero");
    expect(
      resolveWorkspaceName({
        metadataName: "Calimero",
        serverAlias: undefined,
        localAlias: "Calimero",
        groupId: "g",
      }),
    ).toBe("Calimero");
  });
});
