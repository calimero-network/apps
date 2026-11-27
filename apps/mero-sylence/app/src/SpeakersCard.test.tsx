import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeakersCard } from "./SpeakersCard";
import { talkStats } from "./lib/stats";

afterEach(cleanup);

const stats = talkStats(
  [
    { startMs: 0, endMs: 6_000, text: "We ship Friday, right? Yes.", label: "Speaker 1" },
    { startMs: 6_000, endMs: 9_000, text: "Who tests it?", label: "Speaker 2" },
  ],
  (s) => s.label,
);
const tile = (name: string) => screen.getByText(name).nextElementSibling!.textContent;

describe("SpeakersCard", () => {
  it("shows the picked speaker's numbers, picked by tab or by the bar", () => {
    const onSeek = vi.fn();
    render(<SpeakersCard stats={stats} nameOf={(l) => l} canRename={false} onRename={async () => true} onSeek={onSeek} />);
    expect(screen.getAllByTestId("talk-row")).toHaveLength(2);
    expect(tile("Words")).toBe("5");
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    expect(tile("Words")).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: /^Speaker 1:/ }));
    expect(tile("Words")).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: /First spoke at/ }));
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("renames a speaker from their tab", async () => {
    const onRename = vi.fn(async () => true);
    render(<SpeakersCard stats={stats} nameOf={(l) => l} canRename onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Speaker 2" }));
    fireEvent.change(screen.getByLabelText("Name for Speaker 2"), { target: { value: "Eve" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRename).toHaveBeenCalledWith("Speaker 2", "Eve");
  });
});
