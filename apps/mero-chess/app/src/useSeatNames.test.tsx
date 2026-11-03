import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { SeatView, TableView } from "./chess";
import { seatLabel, shortAccount, useSeatNames } from "./useSeatNames";

const seat = (s: Partial<SeatView>): SeatView => ({ seat: "white", member: "", name: "", online: true, ...s });
const table = (white: SeatView, black: SeatView) => ({ me: "acct-me", white, black }) as unknown as TableView;

describe("useSeatNames", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps a name given at the table and labels a Guest by a short account id", () => {
    const view = table(
      seat({ member: "a".repeat(64), name: "Guest" }),
      seat({ seat: "black", member: "acct-ana", name: "Ana" }),
    );
    const { result } = renderHook(() => useSeatNames(view));
    expect(result.current.view?.white.name).toBe("aaaaaa…aaaa");
    expect(result.current.view?.black.name).toBe("Ana");
  });

  it("leaves a free seat unnamed", () => {
    const { result } = renderHook(() => useSeatNames(table(seat({}), seat({ seat: "black" }))));
    expect(result.current.view?.white.name).toBe("");
    expect(seatLabel(seat({ member: "short", name: " " }))).toBe("short");
    expect(shortAccount("abc")).toBe("abc");
  });

  it("remembers the name field across visits", () => {
    window.localStorage.setItem("mero-chess:name", "Sandi");
    const { result } = renderHook(() => useSeatNames(null));
    expect(result.current.name).toBe("Sandi");
    act(() => result.current.changeName("Bob"));
    expect(result.current.name).toBe("Bob");
    expect(window.localStorage.getItem("mero-chess:name")).toBe("Bob");
  });
});
