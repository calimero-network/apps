import { describe, expect, it } from "vitest";
import MessageStore from "./MessageStore";

interface Msg {
  id: string;
  timestamp: number;
  text?: string;
  sender?: string;
}

function storeWith(...messages: Msg[]) {
  const store = new MessageStore<Msg>();
  store.initial(messages);
  return store;
}

const ids = (store: MessageStore<Msg>) => store.messages.map((m) => m.id);

describe("MessageStore id reconciliation", () => {
  it("renames a temp message into its real id", () => {
    const store = storeWith({ id: "temp-1", timestamp: 1, text: "hi" });

    store.updateMultiple([
      { id: "temp-1", descriptor: { updatedFields: { id: "real-1" } } },
    ]);

    expect(ids(store)).toEqual(["real-1"]);
  });

  it("does not throw when the real message already arrived (send/refetch race)", () => {
    // The crash: an optimistic row is reconciled after a refetch already
    // inserted the server's copy, so the target id is taken.
    const store = storeWith(
      { id: "real-1", timestamp: 1, text: "hi" },
      { id: "temp-1", timestamp: 1, text: "hi" },
    );

    expect(() =>
      store.updateMultiple([
        { id: "temp-1", descriptor: { updatedFields: { id: "real-1", text: "hi" } } },
      ]),
    ).not.toThrow();

    // The duplicate temp is gone, the real message survives exactly once.
    expect(ids(store)).toEqual(["real-1"]);
  });

  it("keeps later messages addressable after dropping the duplicate", () => {
    // Removing a row shifts every global index after it; if messageMap is not
    // re-indexed, these updates silently hit the wrong message.
    const store = storeWith(
      { id: "real-1", timestamp: 1, text: "one" },
      { id: "temp-1", timestamp: 2, text: "one" },
      { id: "real-2", timestamp: 3, text: "two" },
      { id: "real-3", timestamp: 4, text: "three" },
    );

    store.updateMultiple([
      { id: "temp-1", descriptor: { updatedFields: { id: "real-1" } } },
    ]);
    expect(ids(store)).toEqual(["real-1", "real-2", "real-3"]);

    store.updateMultiple([
      { id: "real-3", descriptor: { updatedFields: { text: "edited" } } },
    ]);

    expect(store.messages.find((m) => m.id === "real-3")?.text).toBe("edited");
    expect(store.messages.find((m) => m.id === "real-2")?.text).toBe("two");
  });

  it("merges the server's fields into the surviving message", () => {
    const store = storeWith(
      { id: "real-1", timestamp: 1, text: "stale" },
      { id: "temp-1", timestamp: 1, text: "stale" },
    );

    store.updateMultiple([
      {
        id: "temp-1",
        descriptor: { updatedFields: { id: "real-1", text: "from server" } },
      },
    ]);

    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].text).toBe("from server");
  });

  it("still appends genuinely new messages after a reconcile", () => {
    const store = storeWith(
      { id: "real-1", timestamp: 1, text: "hi" },
      { id: "temp-1", timestamp: 1, text: "hi" },
    );

    store.updateMultiple([
      { id: "temp-1", descriptor: { updatedFields: { id: "real-1" } } },
    ]);
    store.append([{ id: "real-2", timestamp: 5, text: "next" }]);

    expect(ids(store)).toEqual(["real-1", "real-2"]);

    store.updateMultiple([
      { id: "real-2", descriptor: { updatedFields: { text: "next!" } } },
    ]);
    expect(store.messages.find((m) => m.id === "real-2")?.text).toBe("next!");
  });
});
