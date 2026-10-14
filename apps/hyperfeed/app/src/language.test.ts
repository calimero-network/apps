import { describe, expect, it } from "vitest";
import { languageOf, languageRule } from "./language";

describe("the language rule", () => {
  it("reads back the language it sets", () => {
    expect(languageOf(languageRule("Serbian"))).toBe("Serbian");
    expect(languageOf("always respond in  german unless the user writes in another language")).toBe("German");
    expect(languageOf("Always respond in Klingon unless the user writes in another language.")).toBe("Klingon");
  });

  it("is no other rule", () => {
    expect(languageOf("Never push to main")).toBeNull();
    expect(languageOf("Always respond in English")).toBeNull();
  });
});
