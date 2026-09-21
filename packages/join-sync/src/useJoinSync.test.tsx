import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useJoinSync, JOIN_SYNC_WATCHDOG_MS, JOIN_SYNC_MAX_MS } from "./useJoinSync";
import {
  markNamespaceJustJoined,
  isNamespaceJustJoined,
  __readJustJoinedSet,
} from "./justJoined";
import { JoinSyncBanner } from "./JoinSyncBanner";

const NS = "a".repeat(64);
const OTHER = "b".repeat(64);

function Probe(props: { namespaceId: string | null; settled: boolean; active?: boolean }) {
  const { isSyncing, dismiss } = useJoinSync(props);
  return (
    <div>
      <span data-testid="state">{isSyncing ? "syncing" : "idle"}</span>
      <button onClick={dismiss}>dismiss</button>
    </div>
  );
}

const state = () => screen.getByTestId("state").textContent;

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the gate only covers a namespace this session just joined", () => {
  it("stays idle for a namespace nobody joined", () => {
    render(<Probe namespaceId={NS} settled={false} />);
    expect(state()).toBe("idle");
  });

  it("gates a just-joined namespace whose data has not arrived", () => {
    markNamespaceJustJoined(NS);
    render(<Probe namespaceId={NS} settled={false} />);
    expect(state()).toBe("syncing");
  });

  it("does not gate a DIFFERENT namespace", () => {
    markNamespaceJustJoined(OTHER);
    render(<Probe namespaceId={NS} settled={false} />);
    expect(state()).toBe("idle");
  });

  it("stays idle with nothing selected", () => {
    markNamespaceJustJoined(NS);
    render(<Probe namespaceId={null} settled={false} />);
    expect(state()).toBe("idle");
  });
});

describe("the gate lifts", () => {
  it("lifts as soon as the app reports its data settled, and forgets the namespace", () => {
    markNamespaceJustJoined(NS);
    const { rerender } = render(<Probe namespaceId={NS} settled={false} />);
    expect(state()).toBe("syncing");

    act(() => {
      rerender(<Probe namespaceId={NS} settled={true} />);
    });

    expect(state()).toBe("idle");
    // Forgotten, so navigating back does not re-gate a settled workspace.
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  // An empty read is a settled answer. Waiting for a non-empty one would gate
  // a genuinely empty workspace until the watchdog expired.
  it("treats a settled-but-empty workspace as arrived", () => {
    markNamespaceJustJoined(NS);
    render(<Probe namespaceId={NS} settled={true} />);
    expect(state()).toBe("idle");
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  it("expires at the base window when nothing is in flight", () => {
    markNamespaceJustJoined(NS);
    render(<Probe namespaceId={NS} settled={false} active={false} />);
    expect(state()).toBe("syncing");

    act(() => {
      vi.advanceTimersByTime(JOIN_SYNC_WATCHDOG_MS + 100);
    });

    expect(state()).toBe("idle");
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  it("holds past the base window while a sync is actually progressing", () => {
    markNamespaceJustJoined(NS);
    render(<Probe namespaceId={NS} settled={false} active={true} />);

    act(() => {
      vi.advanceTimersByTime(JOIN_SYNC_WATCHDOG_MS + 5_000);
    });

    // A cold cross-network join legitimately exceeds the base window.
    expect(state()).toBe("syncing");
  });

  // The ceiling is what stops "active" from being a licence to hang forever.
  it("gives up at the hard ceiling even while the sync still claims progress", () => {
    markNamespaceJustJoined(NS);
    render(<Probe namespaceId={NS} settled={false} active={true} />);

    act(() => {
      vi.advanceTimersByTime(JOIN_SYNC_MAX_MS + 3_000);
    });

    expect(state()).toBe("idle");
  });

  it("can be dismissed by hand", () => {
    markNamespaceJustJoined(NS);
    render(<Probe namespaceId={NS} settled={false} />);
    expect(state()).toBe("syncing");

    act(() => {
      screen.getByText("dismiss").click();
    });

    expect(state()).toBe("idle");
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });
});

describe("the store survives a hostile environment", () => {
  it("never throws when storage is unavailable", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });

    // A blocked-storage session simply gets no gate. It must not break a join.
    expect(() => markNamespaceJustJoined(NS)).not.toThrow();
    expect(isNamespaceJustJoined(NS)).toBe(false);

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("ignores a corrupt stored value instead of crashing the app", () => {
    sessionStorage.setItem("calimero:justJoinedNamespaces", "{not json");
    expect(isNamespaceJustJoined(NS)).toBe(false);
    expect(__readJustJoinedSet().size).toBe(0);
  });

  it("marking the same namespace twice does not duplicate it", () => {
    markNamespaceJustJoined(NS);
    markNamespaceJustJoined(NS);
    expect(__readJustJoinedSet().size).toBe(1);
  });
});

describe("the banner", () => {
  it("renders nothing when not syncing", () => {
    const { container } = render(<JoinSyncBanner show={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("announces itself to assistive tech and names what is arriving", () => {
    render(<JoinSyncBanner show what="vaults" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain("vaults");
    expect(el.getAttribute("aria-live")).toBe("polite");
  });

  it("offers an escape only when one is wired", () => {
    const { rerender } = render(<JoinSyncBanner show />);
    expect(screen.queryByText("Show anyway")).toBeNull();

    const onDismiss = vi.fn();
    rerender(<JoinSyncBanner show onDismiss={onDismiss} />);
    screen.getByText("Show anyway").click();
    expect(onDismiss).toHaveBeenCalled();
  });
});
