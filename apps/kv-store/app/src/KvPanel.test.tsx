import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppError, TrapError } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KvPanel } from "./KvPanel";
import type { KvStore } from "./kvStore";

afterEach(cleanup);

function fakeStore(overrides: Partial<KvStore> = {}): KvStore {
  return {
    set: vi.fn().mockResolvedValue(null),
    updateIfExists: vi.fn().mockResolvedValue(false),
    getOrInsert: vi.fn().mockResolvedValue("first"),
    entries: vi.fn().mockResolvedValue({}),
    len: vi.fn().mockResolvedValue("0"),
    get: vi.fn().mockResolvedValue(null),
    getUnchecked: vi.fn().mockResolvedValue("v"),
    getResult: vi.fn().mockResolvedValue("v"),
    remove: vi.fn().mockResolvedValue(null),
    clear: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("KvPanel", () => {
  it("lists the entries and re-reads them after a write", async () => {
    const entries = vi.fn().mockResolvedValueOnce({}).mockResolvedValue({ greeting: "hello" });
    const kv = fakeStore({ entries });
    render(<KvPanel kv={kv} />);
    await screen.findByText("Empty.");

    type("key", "greeting");
    type("value", "hello");
    fireEvent.click(screen.getByText("set"));
    await screen.findByText("hello");
    expect(kv.set).toHaveBeenCalledWith("greeting", "hello");
    expect(screen.getByText("greeting")).toBeTruthy();
  });

  it("shows each card's own result under its buttons", async () => {
    const kv = fakeStore({ getOrInsert: vi.fn().mockResolvedValue("existing") });
    render(<KvPanel kv={kv} />);
    type("key", "k");
    type("value", "new");
    fireEvent.click(screen.getByText("getOrInsert"));
    await screen.findByText(/"getOrInsert": "existing"/);
    expect(kv.getOrInsert).toHaveBeenCalledWith("k", "new");
  });

  it("names a contract error by its code and fields, and a panic as a trap", async () => {
    const kv = fakeStore({
      getResult: vi.fn().mockRejectedValue(new AppError("app error", { code: "NotFound", fields: { key: "nope" } })),
      getUnchecked: vi.fn().mockRejectedValue(new TrapError("trapped", { kind: "Fault" })),
    });
    render(<KvPanel kv={kv} />);
    type("read key", "nope");
    fireEvent.click(screen.getByText("getResult"));
    await screen.findByText('NotFound {"key":"nope"}');
    fireEvent.click(screen.getByText("getUnchecked"));
    await screen.findByText("the app aborted the call (Fault)");
  });

  it("asks before removing everything", async () => {
    const kv = fakeStore({ entries: vi.fn().mockResolvedValue({ a: "1" }) });
    render(<KvPanel kv={kv} />);
    await screen.findByText("a");
    fireEvent.click(screen.getByText("Remove all"));
    expect(kv.clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm — remove all"));
    await waitFor(() => expect(kv.clear).toHaveBeenCalledTimes(1));
  });

  it("re-reads when another member changes the store", async () => {
    let notify: () => void = () => {};
    const stop = vi.fn();
    const subscribe = vi.fn((onChange: () => void) => {
      notify = onChange;
      return stop;
    });
    const entries = vi.fn().mockResolvedValueOnce({}).mockResolvedValue({ beta: "from-bob" });
    const { unmount } = render(<KvPanel kv={fakeStore({ entries })} subscribe={subscribe} />);
    await screen.findByText("Empty.");
    act(() => notify());
    await screen.findByText("from-bob");
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});
