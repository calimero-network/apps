import { describe, expect, it } from "vitest";
import type { UpdateView } from "../generated/StandupClient";
import { carryForward, EMPTY_DRAFT } from "./carry";

const last: UpdateView = {
  day: "2026-10-12",
  author: "a".repeat(64),
  author_name: "",
  done: "Wrote the spec",
  next: "Build the parser",
  blockers: "Need the API key",
  created_at: 0,
  edited_at: 0,
  helpers: [],
};

describe("carry forward", () => {
  it("turns yesterday's next into today's done and keeps the blocker", () => {
    expect(carryForward(last)).toEqual({
      done: "Build the parser",
      next: "",
      blockers: "Need the API key",
    });
  });

  it("starts empty with no previous update", () => {
    expect(carryForward(null)).toEqual(EMPTY_DRAFT);
  });
});
