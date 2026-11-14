import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyNodeUrl, type CalimeroClient, type NodeVerificationState } from "@calimero-network/mero-js";

import { NodeShield, bindNodeShield } from "./NodeShield";
import { usePasskeySession, type SessionDeps } from "./session";
import { openNodeShield, useNodeShieldApp } from "./nodeShieldStore";

const NODE = "https://node-3.relay.example.net";
const BUNDLE = "7f3a".padEnd(60, "0") + "c91e";

const sealed: NodeVerificationState = {
  status: "verified",
  url: NODE,
  mock: false,
  release: "2.3.148",
  profile: "locked-read-only",
  checkedAt: Date.now(),
};
const mock: NodeVerificationState = { status: "verified", url: "http://127.0.0.1:2528", mock: true, checkedAt: Date.now() };
const refused: NodeVerificationState = { status: "refused", url: NODE, reason: "wrong enclave key", checkedAt: Date.now() };
const unreachable: NodeVerificationState = { status: "unreachable", url: NODE, reason: "network down", checkedAt: Date.now() };

function fakeClient(first: NodeVerificationState) {
  let answer = first;
  const verify = vi.fn(async () => answer);
  const client = {
    nodeUrl: first.url,
    verification: vi.fn(() => answer),
    verify,
    attestApp: vi.fn(async () => ({ url: NODE, mock: false, appHash: BUNDLE, checkedAt: Date.now() })),
    packageCapabilities: vi.fn(),
  };
  return {
    client: client as unknown as CalimeroClient,
    ...client,
    answer: (next: NodeVerificationState) => void (answer = next),
    failOverTo: (url: string) => void (client.nodeUrl = url),
  };
}

let unbind: Array<() => void> = [];
function bind(client: CalimeroClient) {
  unbind.push(bindNodeShield(client, "Calimero Cloud eu-shared-2"));
}

const chip = () => screen.getByTestId("node-shield");
const open = () => fireEvent.click(chip());

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(() => {
  cleanup();
  unbind.forEach((u) => u());
  unbind = [];
  vi.useRealTimers();
});

describe("the placed shield", () => {
  it.each([
    ["a sealed node is green", sealed, "Verified node"],
    ["a test server is grey, whatever its quote", mock, "Test server: not sealed"],
    ["a refused node is red", refused, "Node refused"],
    ["an unreachable node reads as checking", unreachable, "Checking node…"],
  ])("%s", async (_name, state, label) => {
    const { client } = fakeClient(state);
    bind(client);
    render(<NodeShield />);
    await waitFor(() => expect(chip().getAttribute("aria-label")).toBe(label));
    expect(chip().textContent).toContain(label);
  });

  it("opens a dialog on click, closes on Escape, and returns focus to the chip", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    render(<NodeShield />);
    await screen.findByText("Verified node");
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("You are talking to a genuine Calimero TEE node");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chip());
  });

  it("links the public verifier for a real node and offers no link for a test server", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    render(<NodeShield />);
    await screen.findByText("Verified node");
    open();
    const link = await screen.findByRole("link", { name: /Verify independently/ });
    expect(link.getAttribute("href")).toBe(verifyNodeUrl(NODE, "2.3.148"));
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    cleanup();
    unbind.forEach((u) => u());

    const local = fakeClient(mock);
    bind(local.client);
    render(<NodeShield />);
    await screen.findByText("Test server: not sealed");
    open();
    await screen.findByRole("dialog");
    expect(screen.queryByRole("link", { name: /Verify independently/ })).toBeNull();
  });

  it("copies the facts it shows", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    render(<NodeShield />);
    await screen.findByText("Verified node");
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const text = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] as string;
    expect(text).toContain("Node: node-3.relay.example.net");
    expect(text).toContain("Cluster: Calimero Cloud eu-shared-2");
    await screen.findByRole("button", { name: "Copied" });
  });

  it("asks again when it is opened, and keeps retrying an unreachable node", async () => {
    vi.useFakeTimers();
    const { client, verify, answer } = fakeClient(unreachable);
    bind(client);
    render(<NodeShield />);
    await act(async () => {});
    const first = verify.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    expect(chip().textContent).toContain("Checking node…");

    open();
    await act(async () => {});
    expect(screen.getByRole("dialog").textContent).toContain("network down");
    const opened = verify.mock.calls.length;
    expect(opened).toBeGreaterThan(first);

    answer(sealed);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(verify.mock.calls.length).toBeGreaterThan(opened);
    expect(chip().textContent).toContain("Verified node");
  });

  it("checks the node again when the client fails over to another", async () => {
    vi.useFakeTimers();
    const f = fakeClient(sealed);
    f.verify.mockImplementation(async () => ({ ...sealed, url: f.client.nodeUrl }));
    bind(f.client);
    render(<NodeShield />);
    await act(async () => {});
    open();
    await act(async () => {});
    expect(screen.getByRole("dialog").textContent).toContain("node-3.relay.example.net");

    f.failOverTo("https://node-9.relay.example.net");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const text = screen.getByRole("dialog").textContent;
    expect(text).toContain("node-9.relay.example.net");
    expect(text).not.toContain("node-3.relay.example.net");
  });

  it("does not take the app down when the client cannot be checked", async () => {
    bind({ nodeUrl: NODE } as unknown as CalimeroClient);
    render(<NodeShield />);
    await waitFor(() => expect(chip().textContent).toContain("Checking node…"));
    open();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("checking the node before anything is sent");
    expect(dialog.textContent).not.toContain("could not be reached");
  });
});

describe("the app code check", () => {
  function App({ source }: { source: string }) {
    useNodeShieldApp("app-1", source);
    return <NodeShield />;
  }

  it("says the node runs this app's code on a match", async () => {
    const { client, attestApp } = fakeClient(sealed);
    bind(client);
    render(<App source={BUNDLE} />);
    await screen.findByText("Verified node");
    open();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Node runs the bundle this build names"));
    expect(dialog.textContent).toContain("7f3a…c91e");
    expect(attestApp).toHaveBeenCalledWith("app-1");
  });

  it("shows a mismatch as a problem, never as a check", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    render(<App source={"ab".repeat(32)} />);
    await screen.findByText("Verified node");
    open();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Does not match this app's release"));
    expect(dialog.textContent).not.toContain("Node runs the bundle this build names");
  });

  it("never shows one client's code check against another client", async () => {
    const a = fakeClient(sealed);
    bind(a.client);
    render(<App source={BUNDLE} />);
    await screen.findByText("Verified node");
    open();
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Node runs the bundle this build names"));

    const b = fakeClient(sealed);
    b.attestApp.mockImplementation(() => new Promise(() => {}));
    act(() => bind(b.client));
    await waitFor(() => expect(b.attestApp).toHaveBeenCalled());
    expect(screen.getByRole("dialog").textContent).not.toContain("App code");
  });

  it("hides the code check of the node the client failed over from until the new node's check finishes", async () => {
    vi.useFakeTimers();
    const f = fakeClient(sealed);
    f.verify.mockImplementation(async () => ({ ...sealed, url: f.client.nodeUrl }));
    bind(f.client);
    render(<App source={BUNDLE} />);
    await act(async () => {});
    open();
    await act(async () => {});
    expect(screen.getByRole("dialog").textContent).toContain("Node runs the bundle this build names");

    let finish!: () => void;
    f.attestApp.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ url: "https://node-9.relay.example.net", mock: false, appHash: BUNDLE, checkedAt: Date.now() }))),
    );
    f.failOverTo("https://node-9.relay.example.net");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("dialog").textContent).toContain("node-9.relay.example.net");
    expect(screen.getByRole("dialog").textContent).not.toContain("App code");

    await act(async () => finish());
    expect(screen.getByRole("dialog").textContent).toContain("Node runs the bundle this build names");
  });

  it("checks only once the popover is opened", async () => {
    const { client, attestApp } = fakeClient(sealed);
    bind(client);
    render(<App source={BUNDLE} />);
    await screen.findByText("Verified node");
    await act(async () => {});
    expect(attestApp).not.toHaveBeenCalled();
  });

  it("leaves the app code out when no app is registered", async () => {
    const { client, attestApp } = fakeClient(sealed);
    bind(client);
    render(<NodeShield />);
    await screen.findByText("Verified node");
    open();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toContain("App code");
    expect(attestApp).not.toHaveBeenCalled();
  });
});

describe("the built-in floating shield", () => {
  it("shows up with no code in the app, and goes when the session does", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    expect((await screen.findByTestId("node-shield")).textContent).toContain("Verified node");
    expect(screen.getAllByTestId("node-shield")).toHaveLength(1);
    unbind.forEach((u) => u());
    unbind = [];
    await waitFor(() => expect(screen.queryByTestId("node-shield")).toBeNull());
  });

  it("steps aside while an app-placed shield is mounted, and returns when it is not", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    await screen.findByTestId("node-shield");
    const placed = render(<div data-testid="header"><NodeShield /></div>);
    await waitFor(() => expect(screen.getAllByTestId("node-shield")).toHaveLength(1));
    expect(screen.getByTestId("header").contains(chip())).toBe(true);
    placed.unmount();
    await waitFor(() => expect(screen.getAllByTestId("node-shield")).toHaveLength(1));
    expect(document.body.querySelector("[data-node-shield-host]")?.contains(chip())).toBe(true);
  });

  it("is what usePasskeySession mounts, for a signed-out session too", async () => {
    const { client } = fakeClient(sealed);
    const deps: SessionDeps = {
      env: { DEV: true },
      makeClient: async () => ({ ...client, session: null }) as unknown as CalimeroClient,
      passkey: () => ({}) as never,
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    };
    const { result, unmount } = renderHook(() => usePasskeySession("test-app", deps));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    expect((await screen.findByTestId("node-shield")).textContent).toContain("Verified node");
    unmount();
    await waitFor(() => expect(screen.queryByTestId("node-shield")).toBeNull());
  });

  it("renders nothing with no client to check", () => {
    render(<NodeShield />);
    expect(screen.queryByTestId("node-shield")).toBeNull();
  });
});

describe("openNodeShield", () => {
  it("opens the placed shield, not a second one", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    render(<NodeShield />);
    await screen.findByText("Verified node");
    act(() => openNodeShield());
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });

  it("opens one popover when two shields are placed", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    render(
      <>
        <NodeShield />
        <NodeShield />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("node-shield")).toHaveLength(2));
    act(() => openNodeShield());
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });

  it("opens the floating shield when none is placed", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    await screen.findByTestId("node-shield");
    act(() => openNodeShield());
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
