import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingsList } from "./MeetingsList";
import { meeting } from "./test/workspace";

afterEach(cleanup);

describe("MeetingsList", () => {
  const meetings = [
    meeting({ id: "a1", title: "Roadmap review", live: true, platform: "zoom" }),
    meeting({ id: "b2", title: "Weekly sync", openActions: 3 }),
    meeting({ id: "c3", title: "Design sync", platform: "teams" }),
  ];

  it("lists every meeting with its platform, live badge and counts", () => {
    render(<MeetingsList meetings={meetings} onOpen={() => {}} />);
    const rows = screen.getAllByTestId("meeting-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Roadmap review");
    expect(screen.getAllByTestId("live-badge")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Zoom" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Microsoft Teams" })).toBeTruthy();
    expect(rows[1]!.textContent).toContain("30 min");
  });

  it("searches titles as you type", () => {
    render(<MeetingsList meetings={meetings} onOpen={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search meetings" }), { target: { value: "sync" } });
    expect(screen.getAllByTestId("meeting-row").map((r) => r.querySelector(".meeting-title")!.textContent)).toEqual([
      "Weekly sync",
      "Design sync",
    ]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "budget" } });
    expect(screen.queryAllByTestId("meeting-row")).toHaveLength(0);
    expect(screen.getByTestId("no-match").textContent).toContain("budget");
  });

  it("opens a meeting", () => {
    const onOpen = vi.fn();
    render(<MeetingsList meetings={meetings} onOpen={onOpen} />);
    fireEvent.click(screen.getAllByTestId("meeting-row")[2]!);
    expect(onOpen).toHaveBeenCalledWith("c3");
  });

  it("explains the extension when there are no meetings", () => {
    render(<MeetingsList meetings={[]} onOpen={() => {}} />);
    const empty = screen.getByTestId("empty-meetings");
    expect(empty.textContent).toContain("Record your first meeting");
    expect(empty.querySelectorAll(".steps li")).toHaveLength(3);
    const cta = screen.getByRole("link", { name: /Get the extension/ });
    expect(cta.getAttribute("href")).toContain("mero-minutes/extension");
  });

  it("says it is loading, and shows a failed read", () => {
    const { rerender } = render(<MeetingsList meetings={null} onOpen={() => {}} />);
    expect(screen.getByText("Loading meetings…")).toBeTruthy();
    rerender(<MeetingsList meetings={null} error="no route to node" onOpen={() => {}} />);
    expect(screen.getByText("no route to node")).toBeTruthy();
  });
});
