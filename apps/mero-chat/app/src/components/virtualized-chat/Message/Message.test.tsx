import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Message from "./index";
import type { CurbMessage } from "../types/curbTypes";
import { MessageStatus } from "../types/curbTypes";

vi.mock("../../../api/meroJsClient", () => ({ downloadBlob: vi.fn() }));

function message(overrides: Partial<CurbMessage> = {}): CurbMessage {
  return {
    id: "m1",
    text: "hello",
    nonce: "n",
    key: "m1",
    timestamp: 1_700_000_000_000,
    sender: "a".repeat(64),
    reactions: {},
    editedOn: undefined,
    mentions: [],
    files: [],
    images: [],
    status: MessageStatus.sent,
    ...overrides,
  } as CurbMessage;
}

function renderMessage(msg: CurbMessage, editable: boolean) {
  const noop = () => {};
  return render(
    <Message
      message={msg}
      accountId="me"
      editable={editable}
      deletable={false}
      handleReaction={noop}
      openThread={noop}
      getIconFromCache={async () => null}
      isThread={false}
      toggleEmojiSelector={noop}
      editMessage={noop}
      cancelEditMessage={noop}
      deleteMessage={noop}
      openMobileReactions=""
      setOpenMobileReactions={noop}
      submitEditedMessage={noop}
      fetchAccounts={noop}
      autocompleteAccounts={[]}
      authToken={undefined}
      privateIpfsEndpoint=""
    />,
  );
}

// The tick is the author's receipt that their write reached the node. It used
// to render on every row, so other people's messages claimed a delivery state
// this node cannot know.
describe("Message delivery tick", () => {
  it("marks your own message as sent", () => {
    renderMessage(message(), true);
    expect(screen.getByRole("img", { name: "Sent" })).toBeTruthy();
  });

  it("marks your own optimistic message as sending", () => {
    renderMessage(message({ id: "temp-123", key: "temp-123" }), true);
    expect(screen.getByRole("img", { name: "Sending" })).toBeTruthy();
  });

  it("shows no tick on somebody else's message", () => {
    renderMessage(message(), false);
    expect(screen.queryByRole("img", { name: "Sent" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Sending" })).toBeNull();
  });
});
