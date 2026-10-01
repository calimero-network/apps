import { describe, expect, it } from "vitest";
import { buildChannelEntryChat } from "./channelEntry";

describe("buildChannelEntryChat", () => {
  it("opens joined channels directly even before a context profile is read", () => {
    expect(
      buildChannelEntryChat({
        contextId: "context-1",
        name: "general",
        contextIdentity: "pk-1",
        username: "",
      }),
    ).toMatchObject({
      id: "context-1",
      contextId: "context-1",
      contextIdentity: "pk-1",
      canJoin: false,
      requiresProfileSetup: false,
    });
  });

  it("keeps joined channels in the direct-open state when a username already exists", () => {
    expect(
      buildChannelEntryChat({
        contextId: "context-1",
        name: "general",
        contextIdentity: "pk-1",
        username: "alice",
      }),
    ).toMatchObject({
      id: "context-1",
      contextId: "context-1",
      contextIdentity: "pk-1",
      canJoin: false,
      requiresProfileSetup: false,
    });
  });
});
