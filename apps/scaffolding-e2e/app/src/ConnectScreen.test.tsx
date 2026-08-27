import { describe, it, expect, vi, beforeEach } from "vitest";
// `fireEvent`, not `@testing-library/user-event`: the latter is not a dependency
// here and this change is not worth adding one for.
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Both mocked at the module boundary: the point of these tests is that the
// screen ASKS the SDK where the node is instead of making the user type it, so
// the SDK is exactly what has to be observable.
const connectToNode = vi.fn();
const discoverLocalNodes = vi.fn();

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ connectToNode, isOnline: true }),
}));

vi.mock("./lib/mero", () => ({
  clearContextId: vi.fn(),
  discoverLocalNodes: (...args: unknown[]) => discoverLocalNodes(...args),
  getContextId: () => "",
  getNodeUrl: () => null,
  localNodeUrl: (port: number) => `http://localhost:${port}`,
  setContextId: vi.fn(),
  setContextIdentity: vi.fn(),
  setNodeUrl: vi.fn(),
}));

const { ConnectScreen } = await import("./App");

beforeEach(() => {
  connectToNode.mockReset();
  discoverLocalNodes.mockReset();
});

describe("ConnectScreen node discovery", () => {
  it("offers every node the SDK found, without anything being typed", async () => {
    discoverLocalNodes.mockResolvedValue([
      "http://localhost:2528",
      "http://localhost:2529",
    ]);
    render(<ConnectScreen />);

    // Both nodes of a two-node dev stack — the case a single hardcoded default
    // could never reach.
    await waitFor(() => {
      expect(screen.getByText("http://localhost:2528")).toBeTruthy();
    });
    expect(screen.getByText("http://localhost:2529")).toBeTruthy();
  });

  it("connects to a discovered node on one click", async () => {
    discoverLocalNodes.mockResolvedValue(["http://localhost:2529"]);
    render(<ConnectScreen />);

    const btn = await screen.findByText("http://localhost:2529");
    fireEvent.click(btn);

    expect(connectToNode).toHaveBeenCalledWith("http://localhost:2529");
  });

  it("says so when nothing local answered, rather than showing a dead default", async () => {
    discoverLocalNodes.mockResolvedValue([]);
    render(<ConnectScreen />);

    await waitFor(() => {
      expect(screen.getByText(/No local node answered/i)).toBeTruthy();
    });
    // The manual field is the fallback and starts EMPTY: pre-filling
    // `http://localhost:2528` is what used to make a missing node look like a
    // reachable one.
    const input = screen.getByPlaceholderText("http://localhost:2528") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("survives a rejected probe instead of hanging on the scanning state", async () => {
    discoverLocalNodes.mockRejectedValue(new Error("network down"));
    render(<ConnectScreen />);

    await waitFor(() => {
      expect(screen.getByText(/No local node answered/i)).toBeTruthy();
    });
  });

  it("aborts discovery on unmount so a slow probe cannot outlive the screen", async () => {
    let seen: AbortSignal | undefined;
    discoverLocalNodes.mockImplementation((opts: { signal?: AbortSignal }) => {
      seen = opts?.signal;
      return new Promise(() => {}); // never settles
    });
    const { unmount } = render(<ConnectScreen />);
    await waitFor(() => expect(seen).toBeDefined());
    expect(seen!.aborted).toBe(false);
    unmount();
    expect(seen!.aborted).toBe(true);
  });

  it("still allows a remote node to be typed", async () => {
    discoverLocalNodes.mockResolvedValue([]);
    render(<ConnectScreen />);
    await waitFor(() => expect(screen.getByText(/No local node answered/i)).toBeTruthy());

    const input = screen.getByPlaceholderText("http://localhost:2528");
    fireEvent.change(input, { target: { value: "https://node.example.com" } });
    fireEvent.click(screen.getByText("Connect & Login"));

    expect(connectToNode).toHaveBeenCalledWith("https://node.example.com");
  });
});
