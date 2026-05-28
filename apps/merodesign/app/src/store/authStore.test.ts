import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "./authStore";

describe("authStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ nodeUrl: "", accessToken: "", refreshToken: "" });
  });

  it("starts unauthenticated", () => {
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
  });

  it("setAuth marks authenticated", () => {
    useAuthStore.getState().setAuth("http://localhost:2430", "tok-access", "tok-refresh");
    expect(useAuthStore.getState().isAuthenticated()).toBe(true);
    expect(useAuthStore.getState().nodeUrl).toBe("http://localhost:2430");
    expect(useAuthStore.getState().accessToken).toBe("tok-access");
    expect(useAuthStore.getState().refreshToken).toBe("tok-refresh");
  });

  it("clearAuth resets to unauthenticated", () => {
    useAuthStore.getState().setAuth("http://localhost:2430", "tok", "ref");
    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
    expect(useAuthStore.getState().accessToken).toBe("");
    expect(useAuthStore.getState().nodeUrl).toBe("");
  });

  it("isAuthenticated requires both token and nodeUrl", () => {
    useAuthStore.setState({ nodeUrl: "http://localhost:2430", accessToken: "", refreshToken: "" });
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);

    useAuthStore.setState({ nodeUrl: "", accessToken: "tok", refreshToken: "" });
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
  });
});
