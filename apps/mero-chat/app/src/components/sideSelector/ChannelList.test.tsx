import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChannelList from "./ChannelList";

const { mockBuildChannelEntryChat } = vi.hoisted(() => ({
  mockBuildChannelEntryChat: vi.fn((params) => ({
    type: "channel",
    id: params.contextId,
    contextId: params.contextId,
    contextIdentity: params.contextIdentity,
    name: params.name,
  })),
}));

vi.mock("../../utils/channelEntry", () => ({
  buildChannelEntryChat: mockBuildChannelEntryChat,
}));

describe("ChannelList", () => {
  it("shows the alias in the sidebar and uses it for the active-chat name when info is not yet loaded", () => {
    const selectChannel = vi.fn();

    render(
      <ChannelList
        channels={[
          {
            contextId: "abcdefgh12345678",
            alias: "Project Alpha",
            info: null,
            visibility: "open",
            contextIdentity: "member-key-1",
            isJoined: true,
          },
        ]}
        selectedChannelId=""
        selectChannel={selectChannel}
      />,
    );

    const channelRow = screen.getByText("Project Alpha");
    expect(channelRow).toBeInTheDocument();

    fireEvent.click(channelRow);

    // The navbar's activeChatName now falls back to the alias (matching the
    // sidebar) instead of the contextId substring, so users don't see an
    // ID-looking string in the navbar right after joining.
    expect(mockBuildChannelEntryChat).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId: "abcdefgh12345678",
        name: "Project Alpha",
      }),
    );
  });
});
