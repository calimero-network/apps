import { describe, it, expect } from "vitest";
import { resolveBootScreen } from "./boot";

describe("resolveBootScreen", () => {
  it("shows the web landing page only when the app is not enabled", () => {
    expect(
      resolveBootScreen({ appEnabled: false, isLoading: false, isAuthenticated: false }),
    ).toBe("web-landing");
    // The plain web never authenticates, so auth/loading state cannot change it.
    expect(
      resolveBootScreen({ appEnabled: false, isLoading: true, isAuthenticated: false }),
    ).toBe("web-landing");
    expect(
      resolveBootScreen({ appEnabled: false, isLoading: false, isAuthenticated: true }),
    ).toBe("web-landing");
  });

  it("NEVER shows the web landing page inside the desktop", () => {
    // The regression: an unauthenticated desktop window rendered "Desktop app
    // required — Get Calimero Desktop", a dead end with no way forward.
    for (const isLoading of [true, false]) {
      for (const isAuthenticated of [true, false]) {
        expect(
          resolveBootScreen({ appEnabled: true, isLoading, isAuthenticated }),
        ).not.toBe("web-landing");
      }
    }
  });

  it("waits on the auth probe before deciding", () => {
    expect(
      resolveBootScreen({ appEnabled: true, isLoading: true, isAuthenticated: false }),
    ).toBe("loading");
  });

  it("routes an authenticated desktop window into the app", () => {
    expect(
      resolveBootScreen({ appEnabled: true, isLoading: false, isAuthenticated: true }),
    ).toBe("app");
  });

  it("offers desktop sign-in when the node did not authenticate us", () => {
    expect(
      resolveBootScreen({ appEnabled: true, isLoading: false, isAuthenticated: false }),
    ).toBe("desktop-signin");
  });
});
