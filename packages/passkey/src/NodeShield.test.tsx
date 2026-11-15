import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CalimeroClient, type NodeVerificationState } from "@calimero-network/mero-js";

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
  const verify = vi.fn(async () => first);
  const client = {
    nodeUrl: first.url,
    verification: vi.fn(() => first),
    verify,
    attestApp: vi.fn(async () => ({ url: NODE, mock: false, appHash: BUNDLE, checkedAt: Date.now() })),
    packageCapabilities: vi.fn(),
  };
  return {
    client: client as unknown as CalimeroClient,
    ...client,
  };
}

let unbind: Array<() => void> = [];
function bind(client: CalimeroClient) {
  unbind.push(bindNodeShield(client, "Calimero Cloud eu-shared-2"));
}

const chip = () => screen.getByTestId("node-shield");
const open = () => fireEvent.click(chip());

afterEach(() => {
  cleanup();
  unbind.forEach((u) => u());
  unbind = [];
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

  it("shows the cluster it was bound with", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    render(<NodeShield />);
    await screen.findByText("Verified node");
    open();
    expect((await screen.findByRole("dialog")).textContent).toContain("Calimero Cloud eu-shared-2");
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
    await waitFor(() => expect(dialog.textContent).toContain("Node runs the code bundle this app was built for"));
    expect(dialog.textContent).toContain("7f3a…c91e");
    expect(attestApp).toHaveBeenCalledWith("app-1", NODE);
  });

  it("shows a mismatch as a problem, never as a check", async () => {
    const { client } = fakeClient(sealed);
    bind(client);
    render(<App source={"ab".repeat(32)} />);
    await screen.findByText("Verified node");
    open();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Does not match this app's release"));
    expect(dialog.textContent).not.toContain("Node runs the code bundle this app was built for");
  });

  it("never shows one client's code check against another client", async () => {
    const a = fakeClient(sealed);
    bind(a.client);
    render(<App source={BUNDLE} />);
    await screen.findByText("Verified node");
    open();
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Node runs the code bundle this app was built for"));

    const b = fakeClient(sealed);
    b.attestApp.mockImplementation(() => new Promise(() => {}));
    act(() => bind(b.client));
    await waitFor(() => expect(b.attestApp).toHaveBeenCalled());
    expect(screen.getByRole("dialog").textContent).not.toContain("App code");
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

describe("the compact shield", () => {
  /** A `matchMedia` whose queries match when `matches` says so. */
  function viewport(matches: (query: string) => boolean) {
    window.matchMedia = ((query: string) => ({
      matches: matches(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }
  const wrapper = () => chip().parentElement!;

  afterEach(() => void (window.matchMedia = undefined as never));

  it("is icon only below the width it is given", async () => {
    viewport((q) => q === "(max-width: 1100px)");
    const { client } = fakeClient(sealed);
    bind(client);
    render(<NodeShield compactBelow={1100} />);
    await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Verified node"));
    expect(wrapper().classList.contains("mero-node-shield--compact")).toBe(true);
  });

  it("keeps its label at and above that width", async () => {
    viewport(() => false);
    const { client } = fakeClient(sealed);
    bind(client);
    render(<NodeShield compactBelow={1100} />);
    await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Verified node"));
    expect(wrapper().classList.contains("mero-node-shield--compact")).toBe(false);
  });

  it("is always icon only when floating", async () => {
    viewport((q) => /^\(max-width: \d+px\)$/.test(q));
    const { client } = fakeClient(sealed);
    bind(client);
    await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Verified node"));
    expect(wrapper().classList.contains("mero-node-shield--compact")).toBe(true);
  });
});
