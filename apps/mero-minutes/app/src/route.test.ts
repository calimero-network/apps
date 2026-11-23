import { describe, expect, it } from "vitest";
import { linkedWorkspace, parseRoute, routeHash } from "./route";

describe("routes", () => {
  it("reads the page's own links", () => {
    expect(parseRoute("#/m/ab12")).toEqual({ page: "meeting", id: "ab12" });
    expect(parseRoute("#/actions")).toEqual({ page: "actions" });
    expect(parseRoute("")).toEqual({ page: "meetings" });
    expect(routeHash({ page: "meeting", id: "ab12" })).toBe("#/m/ab12");
  });

  it("reads the extension's links, which name the workspace", () => {
    expect(linkedWorkspace("#/w/KTjVV79cWHJgWutwUiJLMA/m/ab12")).toBe("KTjVV79cWHJgWutwUiJLMA");
    expect(parseRoute("#/w/KTjVV79cWHJgWutwUiJLMA/m/ab12")).toEqual({ page: "meeting", id: "ab12" });
    expect(linkedWorkspace("#/w/KTjVV79cWHJgWutwUiJLMA")).toBe("KTjVV79cWHJgWutwUiJLMA");
    expect(parseRoute("#/w/KTjVV79cWHJgWutwUiJLMA")).toEqual({ page: "meetings" });
  });

  it("names no workspace for other links or bad ids", () => {
    expect(linkedWorkspace("#/m/ab12")).toBeNull();
    expect(linkedWorkspace("#/w/<script>")).toBeNull();
  });
});
