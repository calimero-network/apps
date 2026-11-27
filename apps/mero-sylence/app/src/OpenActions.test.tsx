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
    fireEvent.click(screen.getByRole("button", { name: "Open Roadmap" }));
    expect(onOpen).toHaveBeenCalledWith("m2");
  });

  it("folds each call, and opens or folds them all", () => {
    const actions = ["m1", "m2", "m3", "m4"].map((m, i) => a(String(i), m, `Item ${i}`));
    const meetings = ["m1", "m2", "m3", "m4"].map((id) => meeting({ id, title: `Call ${id}` }));
    render(<OpenActionsList actions={actions} meetings={meetings} onToggle={() => {}} onOpen={() => {}} />);
    const groups = screen.getAllByTestId("open-action-group") as HTMLDetailsElement[];
    // Four calls: the newest two start open.
    expect(groups.map((g) => g.open)).toEqual([true, true, false, false]);
    expect(screen.getByText("4 open items from 4 calls")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(groups.every((g) => g.open)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(groups.some((g) => g.open)).toBe(false);
  });

  it("says when nothing is open", () => {
    render(<OpenActionsList actions={[]} meetings={[]} onToggle={() => {}} onOpen={() => {}} />);
    expect(screen.getByTestId("no-open-actions")).toBeTruthy();
  });

  it("groups by person, unassigned last, each item naming its call", () => {
    const onOpen = vi.fn();
    const items = [
      { ...a("1", "m1", "Send the deck"), assignee: "John" },
      { ...a("2", "m2", "Book the room"), assignee: "" },
      { ...a("3", "m2", "Write notes"), assignee: "john" },
    ];
    render(
      <OpenActionsList
        actions={items}
        meetings={[meeting({ id: "m1", title: "Weekly sync" }), meeting({ id: "m2", title: "Roadmap" })]}
        onToggle={() => {}}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "By person" }));
    const people = screen.getAllByTestId("open-action-person");
    expect(people.map((p) => p.querySelector("h2")?.textContent)).toEqual(["John", "Not assigned yet"]);
    expect(people[0]!.querySelectorAll("[data-testid=open-action]")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Roadmap/ })[0]!);
    expect(onOpen).toHaveBeenCalledWith("m2");
  });

  it("shows a done item ticked, and edits, removes and reassigns", () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const onAssign = vi.fn();
    render(
      <OpenActionsList
        actions={[{ ...a("1", "m1", "Send the deck"), done: true }, a("2", "m1", "Book the room")]}
        meetings={[meeting({ id: "m1", title: "Weekly sync" })]}
        onToggle={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
        onAssign={onAssign}
        onOpen={() => {}}
      />,
    );
    expect((screen.getByRole("checkbox", { name: "Done: Send the deck" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("1 open item from 1 call")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Book the room" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Action item text" }), { target: { value: "Book room 4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }), "Book room 4");
    fireEvent.click(screen.getByRole("button", { name: "Remove Send the deck" }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign Book the room" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Assignee name" }), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("option", { name: /Assign to “Sam”/ }));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }), "Sam");
  });
});
