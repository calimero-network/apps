import { beforeEach, describe, expect, it, vi } from "vitest";

const getBridge = vi.fn();
const getNodeUrl = vi.fn();
const setNodeUrl = vi.fn();

vi.mock("@calimero-network/mero-platform", () => ({ getBridge: () => getBridge() }));
vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: () => getNodeUrl(),
  setNodeUrl: (u: string) => setNodeUrl(u),
}));

const { adoptDesktopSession } = await import("./desktopSso");

const BRIDGE = { version: 1, capabilities: [], invoke: vi.fn(), on: vi.fn() };
const CALLBACK = "#access_token=a.b.c&refresh_token=r&node_url=http%3A%2F%2Flocalhost%3A2528";

function hash(h: string) {
  window.history.replaceState({}, "", `/${h}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getBridge.mockReturnValue(null);
  getNodeUrl.mockReturnValue(null);
  hash("");
});

describe("adoptDesktopSession", () => {
  it("seeds the callback node inside the launcher, so a hand-off logs straight in", () => {
    getBridge.mockReturnValue(BRIDGE);
    hash(CALLBACK);
    adoptDesktopSession();
    expect(setNodeUrl).toHaveBeenCalledWith("http://localhost:2528");
  });

  // The security boundary. In a plain tab an attacker-supplied node_url must
  // never become the trusted node.
  it("does NOTHING in a plain browser tab, even with a well-formed callback", () => {
    getBridge.mockReturnValue(null);
    hash("#access_token=a.b.c&node_url=https%3A%2F%2Fevil.example");
    adoptDesktopSession();
    expect(setNodeUrl).not.toHaveBeenCalled();
  });

  it("does not overwrite a node a real in-app login already initiated", () => {
    getBridge.mockReturnValue(BRIDGE);
    getNodeUrl.mockReturnValue("http://localhost:9999");
    hash(CALLBACK);
    adoptDesktopSession();
    expect(setNodeUrl).not.toHaveBeenCalled();
  });

  it("ignores a hash that is not an auth callback", () => {
    getBridge.mockReturnValue(BRIDGE);
    hash("#node_url=http%3A%2F%2Flocalhost%3A2528");
    adoptDesktopSession();
    expect(setNodeUrl).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) node_url", () => {
    getBridge.mockReturnValue(BRIDGE);
    hash("#access_token=a.b.c&node_url=javascript%3Aalert(1)");
    adoptDesktopSession();
    expect(setNodeUrl).not.toHaveBeenCalled();
  });

  it("stores the ORIGIN only, dropping any path the callback carried", () => {
    getBridge.mockReturnValue(BRIDGE);
    hash("#access_token=a.b.c&node_url=http%3A%2F%2Flocalhost%3A2528%2Fadmin-api%2Fx");
    adoptDesktopSession();
    expect(setNodeUrl).toHaveBeenCalledWith("http://localhost:2528");
  });

  it("leaves the hash in place for the provider to consume", () => {
    getBridge.mockReturnValue(BRIDGE);
    hash(CALLBACK);
    adoptDesktopSession();
    expect(window.location.hash).toContain("access_token");
  });
});
