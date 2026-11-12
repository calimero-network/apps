import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppError, TrapError } from "@calimero-network/mero-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KvPanel } from "./KvPanel";
import { KvStoreClient } from "./generated/client";

afterEach(cleanup);

/** What each method answers when a test does not say. */
const DEFAULTS: Record<string, unknown> = {
  set: null,
  updateIfExists: false,
  getOrInsert: "first",
  entries: {},
  len: "0",
  get: null,
  getUnchecked: "v",
  getResult: "v",
  remove: null,
  clear: null,
};

/**
 * The generated client over a fake transport: `sent(method, args)` records
 * every request the panel makes and answers it, from `answers` when a test
 * gives one (a value, or a function of the arguments that may throw).
 */
function fakeStore(answers: Record<string, (args: Record<string, string>) => unknown> = {}) {
  const sent = vi.fn(async (method: string, args: Record<string, string>) =>
    answers[method] ? answers[method](args) : DEFAULTS[method],
  );
  const answer = async ({ method, args }: { method: string; args?: unknown }) => ({
    result: await sent(method, (args ?? {}) as Record<string, string>),
  });
  const kv = new KvStoreClient({ apps: { call: answer, view: answer }, async *events() {} }, "app-1");
  return { kv, sent };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("KvPanel", () => {
  it("lists the entries and re-reads them after a write", async () => {
    const entries = vi.fn().mockReturnValueOnce({}).mockReturnValue({ greeting: "hello" });
    const { kv, sent } = fakeStore({ entries });
    render(<KvPanel kv={kv} />);
    await screen.findByText("Empty.");

    type("key", "greeting");
    type("value", "hello");
    fireEvent.click(screen.getByText("set"));
    await screen.findByText("hello");
    expect(sent).toHaveBeenCalledWith("set", { key: "greeting", value: "hello" });
    expect(screen.getByText("greeting")).toBeTruthy();
  });

  it("shows each card's own result under its buttons", async () => {
    const { kv, sent } = fakeStore({ getOrInsert: () => "existing" });
    render(<KvPanel kv={kv} />);
    type("key", "k");
    type("value", "new");
    fireEvent.click(screen.getByText("getOrInsert"));
    await screen.findByText(/"getOrInsert": "existing"/);
    expect(sent).toHaveBeenCalledWith("getOrInsert", { key: "k", value: "new" });
  });

  it("names a contract error by its code and fields, and a panic as a trap", async () => {
    const { kv, sent } = fakeStore({
      getResult: () => {
        throw new AppError("app error", { code: "NotFound", fields: { key: "nope" } });
      },
      getUnchecked: () => {
        throw new TrapError("trapped", { kind: "Fault" });
      },
    });
    render(<KvPanel kv={kv} />);
    type("read key", "nope");
    fireEvent.click(screen.getByText("getResult"));
    await screen.findByText('NotFound {"key":"nope"}');
    fireEvent.click(screen.getByText("getUnchecked"));
    await screen.findByText("the app aborted the call (Fault)");
    expect(sent).toHaveBeenCalledWith("getResult", { key: "nope" });
    expect(sent).toHaveBeenCalledWith("getUnchecked", { key: "nope" });
  });

  it("asks before removing everything", async () => {
    const { kv, sent } = fakeStore({ entries: () => ({ a: "1" }) });
    const clears = () => sent.mock.calls.filter(([method]) => method === "clear").length;
    render(<KvPanel kv={kv} />);
    await screen.findByText("a");
    fireEvent.click(screen.getByText("Remove all"));
    expect(clears()).toBe(0);
    fireEvent.click(screen.getByText("Confirm — remove all"));
    await waitFor(() => expect(clears()).toBe(1));
  });

  it("re-reads when another member changes the store", async () => {
    let notify: () => void = () => {};
    const stop = vi.fn();
    const subscribe = vi.fn((onChange: () => void) => {
      notify = onChange;
      return stop;
    });
    const entries = vi.fn().mockReturnValueOnce({}).mockReturnValue({ beta: "from-bob" });
    const { unmount } = render(<KvPanel kv={fakeStore({ entries }).kv} subscribe={subscribe} />);
    await screen.findByText("Empty.");
    act(() => notify());
    await screen.findByText("from-bob");
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});
