import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  finishOrg: vi.fn(),
  createChannel: vi.fn(),
  enterWorkspace: vi.fn(),
}));

vi.mock("../api/platform", () => ({ finishOrg: h.finishOrg }));
vi.mock("./createChannel", () => ({ GENERAL_CHANNEL: "general", createChannel: h.createChannel }));
vi.mock("./enterWorkspace", () => ({ enterWorkspace: h.enterWorkspace }));

import { finishWorkspace } from "./finishWorkspace";

const api = () => ({
  resolveCurrentMemberIdentity: vi.fn().mockResolvedValue({ data: { memberIdentity: "me" }, error: null }),
  setMemberMetadata: vi.fn(),
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.createChannel.mockResolvedValue({ contextId: "ctx", memberKey: "k" });
});

describe("finishWorkspace", () => {
  it("finishes the org, makes #general, and enters it", async () => {
    const a = api();
    await finishWorkspace(a, "org-9", "Acme", "Ada", vi.fn());
    expect(h.finishOrg).toHaveBeenCalledWith("org-9");
    expect(h.createChannel).toHaveBeenCalledWith("org-9", "general", true);
    expect(h.enterWorkspace).toHaveBeenCalledWith(a, "org-9", "Ada", "me");
  });

  it("says when #general could not be made, and still enters the workspace", async () => {
    h.createChannel.mockResolvedValue({ error: "no app" });
    const addToast = vi.fn();
    await finishWorkspace(api(), "org-9", "Acme", "Ada", addToast);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Workspace created without #general" }));
    expect(h.enterWorkspace).toHaveBeenCalled();
  });
});
