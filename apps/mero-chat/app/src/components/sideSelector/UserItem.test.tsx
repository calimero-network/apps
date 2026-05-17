import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UserItem from "./UserItem";

vi.mock("@calimero-network/mero-ui", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("../popups/ConfirmPopup", () => ({
  default: ({
    toggle,
    isOpen,
    onConfirm,
    title,
  }: {
    toggle: React.ReactNode;
    isOpen: boolean;
    onConfirm: () => void;
    title: string;
  }) => (
    <div>
      {toggle}
      {isOpen ? <button onClick={onConfirm}>Confirm {title}</button> : null}
    </div>
  ),
}));

describe("UserItem", () => {
  it("shows truncated identity when no username or alias exists", () => {
    render(
      <UserItem
        dm={{
          contextId: "dm-2",
          info: null,
          otherIdentity: "user-2",
          otherAlias: "",
          otherUsername: "",
          contextIdentity: "identity-1",
          myIdentity: "identity-1",
          isJoined: true,
        }}
        onDMSelected={vi.fn()}
        selected={false}
      />,
    );

    // "user-2" is 6 chars (< 8) so returned as-is by getDmDisplayName
    expect(screen.getAllByText("user-2")).toHaveLength(2);
  });

  it("prefers the member alias when no DM profile username exists", () => {
    render(
      <UserItem
        dm={{
          contextId: "dm-4",
          info: null,
          otherIdentity: "user-4",
          otherAlias: "Taylor",
          otherUsername: "",
          contextIdentity: "identity-1",
          myIdentity: "identity-1",
          isJoined: true,
        }}
        onDMSelected={vi.fn()}
        selected={false}
      />,
    );

    expect(screen.getAllByText("Taylor")).toHaveLength(2);
  });

  it("asks for confirmation before joining an unjoined DM", () => {
    const onDMSelected = vi.fn();

    render(
      <UserItem
        dm={{
          contextId: "dm-3",
          info: null,
          otherIdentity: "user-3",
          otherAlias: "",
          otherUsername: "Sam",
          contextIdentity: undefined,
          myIdentity: "",
          isJoined: false,
        }}
        onDMSelected={onDMSelected}
        selected={false}
      />,
    );

    fireEvent.click(screen.getAllByText("Sam")[0]);

    expect(onDMSelected).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm Join DM")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm Join DM"));

    expect(onDMSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId: "dm-3",
      }),
    );
  });
});
