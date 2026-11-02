import { describe, expect, it, vi } from "vitest";
import { findPipelines, parsePipelineId } from "./pipelines";

const stage = (id: string) => ({ id, name: id, probability: 10, position: 0 });

describe("an account's pipelines", () => {
  it("keeps the listed Mero CRM instances that answer, and tries ids named directly", async () => {
    const stagesOf = vi.fn(async (id: string) => {
      if (id === "broken") throw new Error("NOT_FOUND");
      return [stage(`stage-of-${id}`)];
    });
    const found = await findPipelines(
      {
        listInstances: async () => [
          { appId: "crm-1", name: "Sales" },
          { appId: "broken", name: "Gone" },
        ],
        stagesOf,
      },
      ["crm-1", "pasted"],
    );
    expect(found.error).toBeNull();
    expect(found.pipelines.map((p) => [p.contextId, p.name])).toEqual([
      ["crm-1", "Sales"],
      ["pasted", ""],
    ]);
    // The listed one is not read twice.
    expect(stagesOf).toHaveBeenCalledTimes(3);
  });

  it("still tries a named id when the listing fails, and reports the failure when nothing answers", async () => {
    const down = { listInstances: async () => Promise.reject(new Error("cluster down")), stagesOf: async () => [stage("s")] };
    expect((await findPipelines(down, ["crm-9"])).pipelines.map((p) => p.contextId)).toEqual(["crm-9"]);
    expect((await findPipelines(down, [])).error).toBe("cluster down");
  });
});

describe("a pasted pipeline id", () => {
  it("is any app id without whitespace", () => {
    expect(parsePipelineId("  app-123 ")).toBe("app-123");
    expect(parsePipelineId("")).toBeNull();
    expect(parsePipelineId("two words")).toBeNull();
  });
});
