import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";

describe("DeleteWorkspaceDialog", () => {
  afterEach(cleanup);

  it("deletes only once the workspace's name is typed back", () => {
    const onConfirm = vi.fn();
    render(<DeleteWorkspaceDialog name="Testing" open busy={false} onCancel={() => {}} onConfirm={onConfirm} />);
    const del = screen.getByRole("button", { name: "Delete workspace" });
    expect(del).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Type Testing to confirm"), { target: { value: "Test" } });
    expect(del).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Type Testing to confirm"), { target: { value: "Testing" } });
    expect(del).toHaveProperty("disabled", false);
    fireEvent.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not close while the delete runs", () => {
    const onCancel = vi.fn();
    render(<DeleteWorkspaceDialog name="Testing" open busy onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Deleting…" })).toHaveProperty("disabled", true);
  });
});
