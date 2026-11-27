import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionView } from "./sylenceApi";
import { OpenActionsList } from "./OpenActions";
import { meeting } from "./test/workspace";

afterEach(cleanup);

const a = (id: string, meetingId: string, text: string): ActionView => ({
  id,
  meetingId,
  text,
  assignee: "",
  done: false,
  sourceSeq: null,
  createdBy: "bob",
  createdAt: "1",
  updatedAt: "1",
});

describe("OpenActionsList", () => {
  it("groups open items by meeting and ticks one off", () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <OpenActionsList
        actions={[a("1", "m1", "Send the deck"), a("2", "m2", "Book the room"), a("3", "m1", "Write notes")]}
        meetings={[meeting({ id: "m1", title: "Weekly sync" }), meeting({ id: "m2", title: "Roadmap" })]}
        onToggle={onToggle}
        onOpen={onOpen}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Weekly sync", "Roadmap"]);
    expect(screen.getAllByTestId("open-action")).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Book the room" }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }));
    fireEvent.click(screen.getByRole("button", { name: "Roadmap" }));
    expect(onOpen).toHaveBeenCalledWith("m2");
  });

  it("says when nothing is open", () => {
    render(<OpenActionsList actions={[]} meetings={[]} onToggle={() => {}} onOpen={() => {}} />);
    expect(screen.getByTestId("no-open-actions")).toBeTruthy();
  });
});
