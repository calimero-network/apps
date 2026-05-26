import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StartDMPopup from "./StartDMPopup";

const { mockFunctionLoader } = vi.hoisted(() => ({
  mockFunctionLoader: vi.fn(),
}));

vi.mock("../../hooks/usePersistentState", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    usePersistentState: (key: string, initialValue: boolean | string) =>
      React.useState(
        key === "startDMPopupOpen" ? true : initialValue,
      ),
  };
});

vi.mock("../common/popups/BaseModal", () => ({
  default: ({
    toggle,
    content,
    onOpenChange,
  }: {
    toggle: React.ReactNode;
    content: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <div data-testid="modal-trigger" onClick={() => onOpenChange(true)}>
        {toggle}
      </div>
      {content}
    </div>
  ),
}));

vi.mock("../loader/Loader", () => ({
  default: () => <div>loading</div>,
}));

vi.mock("@calimero-network/mero-ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: ({
    value,
    placeholder,
    onChange,
    onFocus,
  }: {
    value: string;
    placeholder?: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onFocus?: () => void;
  }) => (
    <input
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      onFocus={onFocus}
    />
  ),
}));

describe("StartDMPopup", () => {
  beforeEach(() => {
    mockFunctionLoader.mockReset();
    mockFunctionLoader.mockResolvedValue({
      data: "ok",
      error: "",
    });
  });

  it("searches by alias and submits the selected identity", async () => {
    render(
      <StartDMPopup
        title="Create a DM"
        placeholder="Search by member identity"
        buttonText="Next"
        toggle={<button>Open</button>}
        validator={(value) => ({
          isValid: value === "member-b",
          error: value === "member-b" ? "" : "invalid",
        })}
        functionLoader={mockFunctionLoader}
        chatMembers={
          new Map([
            ["member-a", "Alice Alias"],
            ["member-b", "Bob Alias"],
          ])
        }
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Search by member identity"));
    fireEvent.change(screen.getByPlaceholderText("Search by member identity"), {
      target: { value: "bob alias" },
    });

    expect(screen.getByText("Bob Alias")).toBeInTheDocument();
    // The raw identity hash is no longer displayed in the suggestion
    // dropdown — only the human-readable label. The identity is still
    // captured internally (selectedIdentity) and passed to functionLoader
    // on submit.
    expect(screen.queryByText("member-b")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Bob Alias"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockFunctionLoader).toHaveBeenCalledWith("member-b");
    });
  });

  it("shows available member aliases when the popup opens", () => {
    render(
      <StartDMPopup
        title="Create a DM"
        placeholder="Search by member identity"
        buttonText="Next"
        toggle={<button>Open</button>}
        validator={() => ({
          isValid: false,
          error: "",
        })}
        functionLoader={mockFunctionLoader}
        chatMembers={
          new Map([
            ["member-a", "Alice Alias"],
            ["member-b", "Bob Alias"],
          ])
        }
      />,
    );

    expect(screen.getByText("Alice Alias")).toBeInTheDocument();
    expect(screen.getByText("Bob Alias")).toBeInTheDocument();
  });
});

// ── isRefreshing guard ────────────────────────────────────────────────────────
// These tests rely on usePersistentState starting isOpen=true (from the
// module-level mock above), but manipulate isRefreshing via the BaseModal
// mock's onOpenChange trigger.

describe("StartDMPopup — isRefreshing guard", () => {
  it("shows Loading... while onOpen is in-flight and hides real suggestions", async () => {
    let resolveOnOpen!: () => void;
    const pendingOpen = new Promise<void>((res) => {
      resolveOnOpen = res;
    });
    const onOpen = vi.fn(() => pendingOpen);

    // usePersistentState mock starts isOpen=true so popup content is visible.
    // Clicking the modal-trigger fires onOpenChange(true), which re-enters
    // the opening branch and sets isRefreshing while onOpen is pending.
    render(
      <StartDMPopup
        title="New DM"
        placeholder="Search by member identity"
        buttonText="Next"
        toggle={<button type="button">Open</button>}
        validator={() => ({ isValid: false, error: "" })}
        functionLoader={vi.fn().mockResolvedValue({ data: "", error: "" })}
        chatMembers={new Map([["user-x", "User X"]])}
        onOpen={onOpen}
      />,
    );

    // Click the trigger — this calls onOpenChange(true) which sets isRefreshing
    fireEvent.click(screen.getByTestId("modal-trigger"));

    // While onOpen is still pending: Loading... must appear, User X must not
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("User X")).toBeNull();
    // Next button must be disabled while refreshing
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    // Resolve onOpen — isRefreshing clears
    await act(async () => {
      resolveOnOpen();
      await pendingOpen;
    });

    // After resolution: Loading... gone, User X suggestion visible
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
      expect(screen.getByText("User X")).toBeTruthy();
    });
  });
});
