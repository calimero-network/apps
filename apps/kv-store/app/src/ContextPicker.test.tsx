import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextPicker } from "./ContextPicker";

// The mutation hooks, as mero-react ships them: the action catches a failed
// request into the hook's `error` state and resolves `null`. Modelled here the
// same way — the action records the error and returns null, and the next
// render of the hook reports it — because that is exactly the shape that let
// the picker misreport a refusal as "no contextId came back".
let contextError: Error | null = null;
let namespaceError: Error | null = null;
const createContext = vi.fn();
const createNamespace = vi.fn();

vi.mock("@calimero-network/mero-react", () => ({
  setContextId: vi.fn(),
  useApplicationContexts: () => ({
    contexts: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useNamespacesForApplication: () => ({
    namespaces: [{ namespaceId: "ns-1" }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateContext: () => ({ createContext, loading: false, error: contextError }),
  useCreateNamespace: () => ({ createNamespace, loading: false, error: namespaceError }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  contextError = null;
  namespaceError = null;
});

afterEach(cleanup);

describe("ContextPicker", () => {
  it("shows the node's refusal when creating a context fails, not a made-up one", async () => {
    // Seen on prod: `POST /contexts` answered 500 "bytecode blob not found";
    // the picker said "context created but no contextId came back".
    createContext.mockImplementation(async () => {
      contextError = new Error("bytecode blob not found");
      return null;
    });

    render(<ContextPicker applicationId="app-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));

    await screen.findByText("bytecode blob not found");
    expect(screen.queryByText(/no contextId came back/)).toBeNull();
    expect(createContext).toHaveBeenCalledWith({ applicationId: "app-1", groupId: "ns-1" });
  });

  it("shows the namespace hook's error when the one-click path fails at step one", async () => {
    createNamespace.mockImplementation(async () => {
      namespaceError = new Error("application app-1 is not installed on this node");
      return null;
    });

    render(<ContextPicker applicationId="app-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Create namespace + context" }));

    await screen.findByText("application app-1 is not installed on this node");
    expect(createContext).not.toHaveBeenCalled();
    expect(screen.queryByText(/no id came back/)).toBeNull();
  });

  it("still names the failure when the hook resolved null without recording an error", async () => {
    createContext.mockResolvedValue(null);

    render(<ContextPicker applicationId="app-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));

    await screen.findByText(/the context request failed, but the hook reported no error/);
  });
});
