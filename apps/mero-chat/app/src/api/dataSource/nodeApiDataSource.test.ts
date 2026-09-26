import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextApiDataSource } from "./nodeApiDataSource";

const { mockCreateContext } = vi.hoisted(() => ({ mockCreateContext: vi.fn() }));

vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: () => "http://localhost:2428",
}));

vi.mock("../../constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../constants/config")>()),
  getApplicationId: () => "app-1",
}));

vi.mock("../meroJsClient", () => ({
  getAuthConfig: () => ({ jwtToken: "token" }),
  getMeroJs: () => ({ admin: { createContext: mockCreateContext } }),
}));

// core's CreateContextRequest, which is `deny_unknown_fields`: ANY other key is
// a 400 and no context is created. This is the list core's refusal names.
const CREATE_CONTEXT_KEYS = new Set([
  "applicationId",
  "serviceName",
  "contextSeed",
  "initializationParams",
  "groupId",
  "identitySecret",
  "name",
]);

function sentKeys(): string[] {
  return Object.keys(mockCreateContext.mock.calls[0][0]);
}

describe("context create sends only the keys core accepts", () => {
  beforeEach(() => {
    mockCreateContext.mockReset();
    mockCreateContext.mockResolvedValue({ contextId: "ctx-1", memberPublicKey: "pk" });
  });

  it("a channel context — `protocol` and `alias` refused every public AND private channel", async () => {
    // Asserted as a key SET: `objectContaining` passes with a fatal key beside
    // the ones it names, which is how `protocol: "near"` stayed green.
    const res = await new ContextApiDataSource().createGroupContext({
      applicationId: "app-1",
      groupId: "sg-1",
      name: "general",
      initializationParams: { name: "general", context_type: "Channel" },
    });

    expect(res.error).toBeNull();
    expect(sentKeys().filter((k) => !CREATE_CONTEXT_KEYS.has(k))).toEqual([]);
    expect(sentKeys().sort()).toEqual(["applicationId", "groupId", "initializationParams", "name"]);
  });

  it("the legacy createContext path", async () => {
    await new ContextApiDataSource().createContext({ user: "alice", groupId: "sg-1" });

    expect(sentKeys().filter((k) => !CREATE_CONTEXT_KEYS.has(k))).toEqual([]);
  });
});
