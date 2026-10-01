import { describe, expect, it } from "vitest";
import type { ActiveChat } from "../types/Common";
import { getAppEntryState } from "./appEntry";

const buildChat = (overrides: Partial<ActiveChat> = {}): ActiveChat => ({
  type: "channel",
  id: "context-1",
  name: "general",
  contextId: "context-1",
  ...overrides,
});

describe("getAppEntryState", () => {
  it("keeps the user on login until auth, config, and workspace are all present", () => {
    expect(
      getAppEntryState({
        isAuthenticated: true,
        isConfigSet: true,
        groupId: "",
        messengerName: "Ronit",
        activeChat: null,
      }),
    ).toBe("login");
  });

  it("opens browse channels after a workspace is selected with no active chat", () => {
    expect(
      getAppEntryState({
        isAuthenticated: true,
        isConfigSet: true,
        groupId: "group-1",
        messengerName: "Ronit",
        activeChat: null,
      }),
    ).toBe("browse-channels");
  });

  it("keeps the user on login until a global messenger name is chosen", () => {
    expect(
      getAppEntryState({
        isAuthenticated: true,
        isConfigSet: true,
        groupId: "group-1",
        messengerName: "",
        activeChat: buildChat({ requiresProfileSetup: true }),
      }),
    ).toBe("login");
  });

  it("opens joined channels directly after workspace entry", () => {
    expect(
      getAppEntryState({
        isAuthenticated: true,
        isConfigSet: true,
        groupId: "group-1",
        messengerName: "Ronit",
        activeChat: buildChat({ requiresProfileSetup: true }),
      }),
    ).toBe("chat");
  });

  it("routes a ready chat to the normal chat view", () => {
    expect(
      getAppEntryState({
        isAuthenticated: true,
        isConfigSet: true,
        groupId: "group-1",
        messengerName: "Ronit",
        activeChat: buildChat({ requiresProfileSetup: false }),
      }),
    ).toBe("chat");
  });
});
