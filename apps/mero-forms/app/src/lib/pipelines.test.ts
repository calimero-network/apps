import { describe, expect, it, vi } from "vitest";
import { MAX_PROBES, crmRefusalHint, findAccountPipelines, parsePipelineId } from "./pipelines";

const CRM = "c0".repeat(32);
const OTHER = "0f".repeat(32);
const stage = (id: string) => ({ id, name: id, probability: 10, position: 0 });

describe("an account's pipelines", () => {
  it("keeps the Mero CRM contexts, on whichever relay serves each", async () => {
    const stagesOf = vi.fn(async (id: string) => [stage(`stage-of-${id}`)]);
    const found = await findAccountPipelines({
      listContexts: async () => [
        { id: "aa".repeat(32), applicationId: CRM, relayUrl: "https://relay-1.example" },
        { id: "bb".repeat(32), applicationId: OTHER, relayUrl: "https://relay-1.example" },
        { id: "cc".repeat(32), applicationId: CRM.toUpperCase(), relayUrl: "https://relay-2.example" },
        // The same context listed by two relays counts once.
        { id: "aa".repeat(32), applicationId: CRM, relayUrl: "https://relay-2.example" },
      ],
      crmApplicationId: async () => CRM,
      stagesOf,
    });
    expect(found).toEqual([
      { contextId: "aa".repeat(32), stages: [stage(`stage-of-${"aa".repeat(32)}`)], relayUrl: "https://relay-1.example" },
      { contextId: "cc".repeat(32), stages: [stage(`stage-of-${"cc".repeat(32)}`)], relayUrl: "https://relay-2.example" },
    ]);
    // Read through the relay that serves each one, and never the other app's context.
    expect(stagesOf).toHaveBeenCalledWith("cc".repeat(32), "https://relay-2.example");
    expect(stagesOf).not.toHaveBeenCalledWith("bb".repeat(32), expect.anything());
  });

  it("tries each context as a pipeline when the registry cannot say, up to a limit", async () => {
    const contexts = Array.from({ length: MAX_PROBES + 5 }, (_, i) => ({
      id: i.toString(16).padStart(64, "0"),
      applicationId: i === 1 ? CRM : OTHER,
      relayUrl: "https://relay.example",
    }));
    const stagesOf = vi.fn(async (id: string) => {
      if (id !== contexts[1]!.id) throw new Error("method not found: list_stages");
      return [stage("lead")];
    });
    const found = await findAccountPipelines({
      listContexts: async () => contexts,
      crmApplicationId: async () => {
        throw new Error("registry unreachable");
      },
      stagesOf,
    });
    expect(found.map((p) => p.contextId)).toEqual([contexts[1]!.id]);
    expect(stagesOf).toHaveBeenCalledTimes(MAX_PROBES);
  });

  it("skips a pipeline whose relay does not answer", async () => {
    const found = await findAccountPipelines({
      listContexts: async () => [{ id: "aa".repeat(32), applicationId: CRM, relayUrl: "https://down.example" }],
      crmApplicationId: async () => CRM,
      stagesOf: async () => {
        throw new Error("fetch failed");
      },
    });
    expect(found).toEqual([]);
  });
});

describe("a pasted pipeline id", () => {
  it("is 64 hex, tidied", () => {
    expect(parsePipelineId(`  ${"AB".repeat(32)} `)).toBe("ab".repeat(32));
    expect(parsePipelineId("ab".repeat(31))).toBeNull();
    expect(parsePipelineId("not an id")).toBeNull();
  });
});

describe("a refused CRM write", () => {
  it("says what to do when a relay may not write CRM records for you", () => {
    expect(
      crmRefusalHint(
        "relay refused the intent (HTTP 403): this node is not a RelayTee in this namespace, and only a RelayTee signs entries on a member's behalf",
      ),
    ).toMatch(/only a Calimero Cloud relay can/);
    expect(crmRefusalHint("deal title must not be empty")).toBeNull();
  });
});
