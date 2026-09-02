import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import LayersPanel from "./LayersPanel";
import { useEditorStore } from "../store/editorStore";
import { makeGroup, makeLayer } from "../test/factories";
import type { Layer } from "../types";

/**
 *   Header (folder, 40)
 *     Logo (30)
 *     Nav  (folder, 20)
 *       Nav item (10)
 *   Background (0)
 */
function seed(extra: Layer[] = []) {
  useEditorStore.getState().setLayers([
    makeLayer({ id: "bg", name: "Background", layerIndex: 0 }),
    makeLayer({ id: "nav-item", name: "Nav item", layerIndex: 10, parentId: "nav" }),
    makeGroup({ id: "nav", name: "Nav", layerIndex: 20, parentId: "header" }),
    makeLayer({ id: "logo", name: "Logo", layerIndex: 30, parentId: "header" }),
    makeGroup({ id: "header", name: "Header", layerIndex: 40 }),
    ...extra,
  ]);
}

const handlers = () => ({
  onAdd: vi.fn(),
  onDelete: vi.fn(),
  onDuplicate: vi.fn(),
  onUpdateMeta: vi.fn(),
  onUpdateText: vi.fn(),
  onReorder: vi.fn(),
  onGroupSelected: vi.fn(),
  onUngroup: vi.fn(),
  onToggleMask: vi.fn(),
});

function panel(props = handlers()) {
  render(<LayersPanel {...props} />);
  return props;
}

/** Row ids in display order. */
function rowIds(): string[] {
  return [...document.querySelectorAll("[data-testid^='layer-row-']")]
    .map((el) => el.getAttribute("data-testid")!.replace("layer-row-", ""));
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`layer-row-${id}`);
}

beforeEach(() => {
  useEditorStore.setState({
    layers: [], selectedLayerId: null, selectedLayerIds: [], collapsedGroups: {},
    myRole: "admin", panelCollapsed: {
      navigator: false, adjustments: false, transform: false, history: true, layers: false,
    },
  });
  seed();
});

describe("LayersPanel as a folder tree", () => {
  it("renders folders above their contents, front-most first", () => {
    panel();
    expect(rowIds()).toEqual(["header", "logo", "nav", "nav-item", "bg"]);
  });

  it("indents each nesting level", () => {
    panel();
    expect(row("header").style.paddingLeft).toBe("8px");
    expect(row("logo").style.paddingLeft).toBe("22px");
    expect(row("nav-item").style.paddingLeft).toBe("36px");
  });

  it("marks folder rows so they can be styled and targeted", () => {
    panel();
    expect(row("header").getAttribute("data-kind")).toBe("group");
    expect(row("bg").getAttribute("data-kind")).toBe("raster");
  });

  it("shows how many layers a folder holds, at any depth", () => {
    panel();
    expect(screen.getByTestId("group-count-header")).toHaveTextContent("3");
    expect(screen.getByTestId("group-count-nav")).toHaveTextContent("1");
  });

  it("collapses a folder's subtree from its twirl", () => {
    panel();
    fireEvent.click(screen.getByTestId("group-twirl-header"));
    expect(rowIds()).toEqual(["header", "bg"]);
    expect(useEditorStore.getState().collapsedGroups.header).toBe(true);
  });

  it("collapses only the inner folder when that is the one clicked", () => {
    panel();
    fireEvent.click(screen.getByTestId("group-twirl-nav"));
    expect(rowIds()).toEqual(["header", "logo", "nav", "bg"]);
  });

  it("re-expands on a second click and reports state to assistive tech", () => {
    panel();
    const twirl = screen.getByTestId("group-twirl-header");
    fireEvent.click(twirl);
    expect(screen.getByTestId("group-twirl-header")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByTestId("group-twirl-header"));
    expect(screen.getByTestId("group-twirl-header")).toHaveAttribute("aria-expanded", "true");
    expect(rowIds()).toHaveLength(5);
  });

  it("collapses and expands every folder from the header control", () => {
    panel();
    fireEvent.click(screen.getByTestId("collapse-all-groups"));
    expect(rowIds()).toEqual(["header", "bg"]);
    fireEvent.click(screen.getByTestId("collapse-all-groups"));
    expect(rowIds()).toHaveLength(5);
  });

  it("does not give a plain layer a twirl", () => {
    panel();
    expect(screen.queryByTestId("group-twirl-bg")).toBeNull();
  });

  it("clicking a folder row selects the folder and its contents", () => {
    panel();
    fireEvent.click(row("header"));
    const s = useEditorStore.getState();
    expect(s.selectedLayerIds.sort()).toEqual(["header", "logo", "nav", "nav-item"]);
    expect(s.selectedLayerId).toBe("header");
    expect(screen.getByText("4 selected")).toBeInTheDocument();
  });

  it("shows the folder's contents count and an Ungroup action when one is selected", () => {
    const props = panel();
    fireEvent.click(row("header"));
    expect(screen.getByTestId("group-content-count")).toHaveTextContent("3 layers inside");
    fireEvent.click(screen.getByTestId("ungroup-selected"));
    expect(props.onUngroup).toHaveBeenCalledWith("header");
  });

  it("says '1 layer inside' rather than '1 layers inside'", () => {
    panel();
    fireEvent.click(row("nav"));
    expect(screen.getByTestId("group-content-count")).toHaveTextContent("1 layer inside");
  });

  it("only enables the toolbar's Ungroup for a folder", () => {
    panel();
    fireEvent.click(row("bg"));
    expect(screen.getByTestId("ungroup-folder")).toBeDisabled();
    fireEvent.click(row("nav"));
    expect(screen.getByTestId("ungroup-folder")).toBeEnabled();
  });

  it("wires the Group button to the group action", () => {
    const props = panel();
    fireEvent.click(row("bg"));
    fireEvent.click(screen.getByTestId("group-selected"));
    expect(props.onGroupSelected).toHaveBeenCalled();
  });

  it("renames a folder on double-click", () => {
    const props = panel();
    fireEvent.doubleClick(within(row("header")).getByText("Header"));
    const input = screen.getByTestId("layer-rename-header");
    fireEvent.change(input, { target: { value: "  Masthead  " } });
    fireEvent.blur(input);
    expect(props.onUpdateMeta).toHaveBeenCalledWith("header", { name: "Masthead" });
  });

  it("keeps the old name when a rename is submitted empty", () => {
    const props = panel();
    fireEvent.doubleClick(within(row("nav")).getByText("Nav"));
    const input = screen.getByTestId("layer-rename-nav");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(props.onUpdateMeta).toHaveBeenCalledWith("nav", { name: "Nav" });
  });

  it("abandons a rename on Escape", () => {
    const props = panel();
    fireEvent.doubleClick(within(row("nav")).getByText("Nav"));
    fireEvent.keyDown(screen.getByTestId("layer-rename-nav"), { key: "Escape" });
    expect(props.onUpdateMeta).not.toHaveBeenCalled();
  });
});

describe("LayersPanel drag and drop", () => {
  it("dropping a layer onto a folder nests it, and reveals the folder", () => {
    const props = panel();
    act(() => useEditorStore.getState().setGroupCollapsed("header", true));
    fireEvent.dragStart(row("bg"));
    fireEvent.dragOver(row("header"));
    fireEvent.drop(row("header"));
    expect(props.onUpdateMeta).toHaveBeenCalledWith("bg", { parentId: "header" });
    expect(useEditorStore.getState().collapsedGroups.header).toBe(false);
  });

  it("refuses to drop a folder into its own descendant", () => {
    const props = panel();
    fireEvent.dragStart(row("header"));
    fireEvent.dragOver(row("nav"));
    fireEvent.drop(row("nav"));
    expect(props.onUpdateMeta).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("dropping onto a plain layer reorders instead of nesting", () => {
    const props = panel();
    fireEvent.dragStart(row("bg"));
    fireEvent.drop(row("logo"));
    expect(props.onReorder).toHaveBeenCalled();
    const order = props.onReorder.mock.calls[0][0] as string[];
    expect(order).toHaveLength(5);
    expect(order.indexOf("bg")).toBeLessThan(order.indexOf("nav"));
  });

  it("joins the folder of the layer it is dropped next to", () => {
    const props = panel();
    fireEvent.dragStart(row("bg"));
    fireEvent.drop(row("logo")); // Logo lives in Header
    expect(props.onUpdateMeta).toHaveBeenCalledWith("bg", { parentId: "header" });
  });

  it("offers a root strip during a drag, and it lifts a layer out", () => {
    const props = panel();
    expect(screen.queryByTestId("root-drop-zone")).toBeNull();
    fireEvent.dragStart(row("logo"));
    const zone = screen.getByTestId("root-drop-zone");
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);
    expect(props.onUpdateMeta).toHaveBeenCalledWith("logo", { parentId: null });
  });

  it("dropping a top-level layer on the root strip changes nothing", () => {
    const props = panel();
    fireEvent.dragStart(row("bg"));
    fireEvent.drop(screen.getByTestId("root-drop-zone"));
    expect(props.onUpdateMeta).not.toHaveBeenCalled();
  });

  it("dropping a row on itself is a no-op", () => {
    const props = panel();
    fireEvent.dragStart(row("bg"));
    fireEvent.drop(row("bg"));
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onUpdateMeta).not.toHaveBeenCalled();
  });

  it("renumbers hidden rows too, so collapsing cannot reshuffle a folder", () => {
    const props = panel();
    // A store write from outside an event handler needs flushing before the DOM
    // reflects it — React 19 batches these.
    act(() => useEditorStore.getState().setGroupCollapsed("header", true));
    expect(rowIds()).toEqual(["header", "bg"]); // Logo/Nav/Nav item are hidden
    fireEvent.click(within(row("header")).getByLabelText("Move layer down"));
    const order = props.onReorder.mock.calls[0][0] as string[];
    expect(order).toHaveLength(5);
    expect(order).toContain("nav-item");
  });
});

describe("LayersPanel and permissions", () => {
  it("hides the editing toolbar and drag handles for a viewer", () => {
    useEditorStore.setState({ myRole: "viewer" });
    panel();
    expect(screen.queryByTestId("group-selected")).toBeNull();
    expect(row("header").getAttribute("draggable")).toBe("false");
  });

  it("does not let a viewer start a rename", () => {
    useEditorStore.setState({ myRole: "viewer" });
    panel();
    fireEvent.doubleClick(within(row("header")).getByText("Header"));
    expect(screen.queryByTestId("layer-rename-header")).toBeNull();
  });

  it("shows an empty state when there are no layers", () => {
    useEditorStore.getState().setLayers([]);
    panel();
    expect(screen.getByText("No layers yet")).toBeInTheDocument();
  });
});
