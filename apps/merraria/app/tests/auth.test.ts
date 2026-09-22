import { beforeEach, describe, expect, it } from "vitest";
import { beginWebLogin, buildLoginUrl, PACKAGE_NAME, PERMISSIONS, takePendingNodeUrl } from "../src/net/auth";

beforeEach(() => localStorage.clear());

describe("buildLoginUrl", () => {
  it("builds the exact mero-js auth login format", () => {
    const url = buildLoginUrl("http://localhost:2428", "http://localhost:5183/");
    expect(url.startsWith("http://localhost:2428/auth/login?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("callback-url")).toBe("http://localhost:5183/");
    expect(params.get("mode")).toBe("multi-context");
    expect(params.get("package-name")).toBe(PACKAGE_NAME);
    expect(params.get("registry-url")).toBe("https://apps.calimero.network");
    expect(params.get("permissions")).toBe(PERMISSIONS.join(","));
  });

  it("trims trailing slashes from the node url", () => {
    const url = buildLoginUrl("http://node:2428///", "cb");
    expect(url.startsWith("http://node:2428/auth/login?")).toBe(true);
  });

  it("requests the multi-context grant set (context create/list/execute)", () => {
    for (const grant of ["context:create", "context:list", "context:execute", "application:list"]) {
      expect(PERMISSIONS).toContain(grant);
    }
  });

  // Stated as a property rather than another entry in the list above, because
  // the list is the thing that was wrong. Core maps /sse, /sse/subscription and
  // /ws to Context(Subscribe(Global)), so a token minted without this grant is
  // refused 403 permission_denied on all three and the game never receives an
  // event — while looking perfectly healthy otherwise. MEASURED on rc.41.
  it("asks for context:subscribe, without which no event ever arrives", () => {
    expect(PERMISSIONS).toContain("context:subscribe");
  });
});

describe("beginWebLogin", () => {
  it("stashes the node url and navigates to the auth page", () => {
    let target = "";
    beginWebLogin("http://mynode:2428/", (url) => (target = url));
    expect(localStorage.getItem("mt-pending-node")).toBe("http://mynode:2428");
    expect(target).toContain("http://mynode:2428/auth/login?");
    expect(target).toContain("callback-url=");
    // callback carries no stale hash
    expect(new URL(target).searchParams.get("callback-url")).not.toContain("#");
  });
});

describe("takePendingNodeUrl", () => {
  it("is consumed exactly once", () => {
    localStorage.setItem("mt-pending-node", "http://n:1");
    expect(takePendingNodeUrl()).toBe("http://n:1");
    expect(takePendingNodeUrl()).toBeNull();
  });
});
