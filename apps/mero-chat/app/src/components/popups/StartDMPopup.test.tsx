import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  }: {
    toggle: React.ReactNode;
    content: React.ReactNode;
  }) => (
    <div>
      {toggle}
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
