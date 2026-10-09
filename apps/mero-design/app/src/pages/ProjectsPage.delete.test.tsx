// Deleting a project: the card goes only once the node has deleted the
// context. A refusal used to be swallowed and the card dropped anyway, so a
// 403 looked like a delete until the next reload brought the project back.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteContext = vi.fn();
const showToast = vi.fn();

const CTX = "5f4be3609f2916888dcfc0d6568bbcbb2778381cf9669f69738a056ee2617346";
const GROUP = "group-1";

vi.mock("../api/rpc", () => ({
  createContext: vi.fn(),
  createNamespaceInvitation: vi.fn(),
  createSubgroup: vi.fn(),
  deleteContext: (...a: unknown[]) => deleteContext(...a),
  listGroupContexts: vi.fn().mockResolvedValue([{ contextId: CTX, name: "Poster" }]),
  listSubgroups: vi.fn().mockResolvedValue([{ groupId: GROUP, name: "Poster" }]),
  setSubgroupVisibility: vi.fn(),
}));
vi.mock("../hooks/useApplicationId", () => ({
  useApplicationId: () => async () => "app-1",
}));
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ logout: vi.fn(), isDelegated: false }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ teamId: "team-1" }),
}));
vi.mock("../contexts/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));
vi.mock("../components/SettingsModal", () => ({ default: () => null }));
vi.mock("../components/Logo", () => ({ default: () => null }));
vi.mock("../components/ProjectThumbnail", () => ({ default: () => null }));

const ProjectsPage = (await import("./ProjectsPage")).default;

async function clickDelete(): Promise<void> {
  render(<ProjectsPage />);
  await screen.findByTestId(`project-card-${CTX}`);
  fireEvent.click(screen.getByTitle("More options"));
  fireEvent.click(screen.getByTestId(`project-delete-${CTX}`));
}

describe("ProjectsPage – delete a project", () => {
  beforeEach(() => {
    deleteContext.mockReset();
    showToast.mockReset();
  });

  it("removes the card once the node deleted the context", async () => {
    deleteContext.mockResolvedValue(undefined);
    await clickDelete();

    expect(deleteContext).toHaveBeenCalledWith(CTX);
    await waitFor(() => expect(screen.queryByTestId(`project-card-${CTX}`)).toBeNull());
    expect(showToast).not.toHaveBeenCalled();
  });

  it("keeps the card and says why when the node refuses", async () => {
    deleteContext.mockRejectedValue(
      Object.assign(new Error("HTTP 403"), {
        explanation: "caller lacks the permissions this route requires",
      }),
    );
    await clickDelete();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("caller lacks the permissions this route requires"),
    );
    expect(screen.getByTestId(`project-card-${CTX}`)).toBeTruthy();
  });
});
