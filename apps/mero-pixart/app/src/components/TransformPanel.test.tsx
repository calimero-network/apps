import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TransformPanel from "./TransformPanel";
import { useEditorStore } from "../store/editorStore";
import { presetCorners } from "../utils/warpPresets";
import { parseWarp, serializeWarp } from "../utils/transform";
import { makeGroup, makeLayer } from "../test/factories";
import type { Layer } from "../types";

const handlers = () => ({
  onTransform: vi.fn(),
  onMove: vi.fn(),
  onApplyTransform: vi.fn(),
});

function panel(layer?: Layer, props = handlers(), disabled = false) {
  render(<TransformPanel layer={layer} disabled={disabled} {...props} />);
  return props;
}

/** The single patch a control produced. */
function patch(fn: ReturnType<typeof vi.fn>, call = 0) {
  return fn.mock.calls[call][1] as Partial<Layer>;
}

beforeEach(() => {
  useEditorStore.setState({
    activeTool: "move", transformMode: "free",
    panelCollapsed: { navigator: false, adjustments: false, transform: false, history: true, layers: false },
  });
});

describe("TransformPanel", () => {
  it("asks for a selection when there is none", () => {
    panel(undefined);
    expect(screen.getByText("Select a layer to transform it.")).toBeInTheDocument();
    expect(screen.queryByTestId("transform-rotation")).toBeNull();
  });

  it("reads the layer's transform back", () => {
    panel(makeLayer({
      x: 12, y: 34, rotation: 45, skewX: 20, skewY: -10,
      width: 100, height: 100,
    }));
    expect(screen.getByTestId("transform-x")).toHaveValue(12);
    expect(screen.getByTestId("transform-y")).toHaveValue(34);
    expect(screen.getByTestId("transform-rotation")).toHaveValue(45);
    expect(screen.getByTestId("transform-skewx")).toHaveValue(20);
    expect(screen.getByTestId("transform-skewy")).toHaveValue(-10);
  });

  it("moves a layer to an absolute position", () => {
    const props = panel(makeLayer({ x: 0, y: 0 }));
    fireEvent.change(screen.getByTestId("transform-x"), { target: { value: "250" } });
    expect(props.onMove).toHaveBeenCalledWith(expect.any(String), 250, 0);
  });

  it("sets rotation from the box and from the slider", () => {
    const props = panel(makeLayer({ rotation: 0 }));
    fireEvent.change(screen.getByTestId("transform-rotation"), { target: { value: "33" } });
    expect(patch(props.onTransform)).toEqual({ rotation: 33 });
    fireEvent.change(screen.getByTestId("transform-rotation-range"), { target: { value: "-90" } });
    expect(patch(props.onTransform, 1)).toEqual({ rotation: -90 });
  });

  it("wraps a quarter turn past 180° instead of storing 270", () => {
    const props = panel(makeLayer({ rotation: 170 }));
    fireEvent.click(screen.getByTestId("rotate-cw"));
    expect(patch(props.onTransform)).toEqual({ rotation: -100 });
  });

  it("turns the other way too", () => {
    const props = panel(makeLayer({ rotation: 0 }));
    fireEvent.click(screen.getByTestId("rotate-ccw"));
    expect(patch(props.onTransform)).toEqual({ rotation: -90 });
  });

  it("clamps a typed angle to the slider's range", () => {
    const props = panel(makeLayer({ rotation: 0 }));
    fireEvent.change(screen.getByTestId("transform-rotation"), { target: { value: "9999" } });
    expect(patch(props.onTransform)).toEqual({ rotation: 180 });
  });

  it("clamps shear to the range the contract stores", () => {
    const props = panel(makeLayer({ skewX: 0 }));
    fireEvent.change(screen.getByTestId("transform-skewx"), { target: { value: "400" } });
    expect(patch(props.onTransform)).toEqual({ skewX: 80 });
    fireEvent.change(screen.getByTestId("transform-skewy"), { target: { value: "-400" } });
    expect(patch(props.onTransform, 1)).toEqual({ skewY: -80 });
  });

  it("toggles both mirrors and shows their state", () => {
    const props = panel(makeLayer({ flipH: true, flipV: false }));
    expect(screen.getByTestId("flip-h")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("flip-v")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("flip-h"));
    expect(patch(props.onTransform)).toEqual({ flipH: false });
    fireEvent.click(screen.getByTestId("flip-v"));
    expect(patch(props.onTransform, 1)).toEqual({ flipV: true });
  });
});

describe("TransformPanel warp controls", () => {
  it("writes exactly the preset's corners", () => {
    const layer = makeLayer({ width: 200, height: 100 });
    const props = panel(layer);
    fireEvent.click(screen.getByTestId("warp-preset-perspective"));
    expect(patch(props.onTransform)).toEqual({
      warp: serializeWarp(presetCorners("perspective", layer)),
    });
  });

  it("offers every preset", () => {
    panel(makeLayer());
    for (const preset of ["perspective", "keystone", "fan", "twist"]) {
      expect(screen.getByTestId(`warp-preset-${preset}`)).toBeInTheDocument();
    }
  });

  it("nudges one corner without disturbing the others", () => {
    const start = { tl: [4, 0], tr: [0, 0], br: [0, 0], bl: [0, 0] } as const;
    const props = panel(makeLayer({ warp: JSON.stringify(start) }));
    fireEvent.change(screen.getByTestId("warp-br-y"), { target: { value: "-9" } });
    const next = parseWarp(patch(props.onTransform).warp)!;
    expect(next.br).toEqual([0, -9]);
    expect(next.tl).toEqual([4, 0]);
  });

  it("shows the stored corner offsets", () => {
    panel(makeLayer({ warp: '{"tl":[3,4],"tr":[0,0],"br":[0,0],"bl":[-5,0]}' }));
    expect(screen.getByTestId("warp-tl-x")).toHaveValue(3);
    expect(screen.getByTestId("warp-tl-y")).toHaveValue(4);
    expect(screen.getByTestId("warp-bl-x")).toHaveValue(-5);
  });

  it("clears the warp with None, which is only live once there is one", () => {
    const props = panel(makeLayer({ warp: '{"tl":[9,9],"tr":[0,0],"br":[0,0],"bl":[0,0]}' }));
    fireEvent.click(screen.getByTestId("warp-reset"));
    expect(patch(props.onTransform)).toEqual({ warp: "" });
  });

  it("disables None when the layer has no warp", () => {
    panel(makeLayer({ warp: "" }));
    expect(screen.getByTestId("warp-reset")).toBeDisabled();
  });

  it("the Pins button switches to the Transform tool in warp mode", () => {
    panel(makeLayer());
    fireEvent.click(screen.getByTestId("warp-mode-toggle"));
    const s = useEditorStore.getState();
    expect(s.activeTool).toBe("transform");
    expect(s.transformMode).toBe("warp");
  });

  it("…and back off again", () => {
    useEditorStore.setState({ activeTool: "transform", transformMode: "warp" });
    panel(makeLayer());
    expect(screen.getByTestId("warp-mode-toggle")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("warp-mode-toggle"));
    expect(useEditorStore.getState().transformMode).toBe("free");
  });
});

describe("TransformPanel reset and apply", () => {
  it("Reset clears every transform field at once", () => {
    const props = panel(makeLayer({ rotation: 20, skewX: 5, flipH: true, warp: '{"tl":[1,1],"tr":[0,0],"br":[0,0],"bl":[0,0]}' }));
    fireEvent.click(screen.getByTestId("transform-reset"));
    expect(patch(props.onTransform)).toEqual({
      rotation: 0, skewX: 0, skewY: 0, flipH: false, flipV: false,
      scaleX: 100, scaleY: 100, warp: "",
    });
  });

  it("Apply bakes a raster layer", () => {
    const layer = makeLayer({ rotation: 20 });
    const props = panel(layer);
    fireEvent.click(screen.getByTestId("transform-apply"));
    expect(props.onApplyTransform).toHaveBeenCalledWith(layer.id);
  });

  it("cannot bake a folder or a text layer", () => {
    panel(makeGroup());
    expect(screen.getByTestId("transform-apply")).toBeDisabled();
  });

  it("reports the layer's true bounds, rotation included", () => {
    panel(makeLayer({ width: 100, height: 100, rotation: 45 }));
    // a 45°-rotated 100px square bounds to ~141px
    expect(screen.getByTestId("transform-bounds")).toHaveTextContent("141 × 141");
  });

  it("is fully read-only for a viewer", () => {
    panel(makeLayer(), handlers(), true);
    expect(screen.getByTestId("transform-rotation")).toBeDisabled();
    expect(screen.getByTestId("flip-h")).toBeDisabled();
    expect(screen.getByTestId("warp-preset-fan")).toBeDisabled();
    expect(screen.getByTestId("transform-apply")).toBeDisabled();
  });

  it("collapses to its header", () => {
    panel(makeLayer());
    fireEvent.click(screen.getByLabelText("Collapse Transform"));
    expect(screen.queryByTestId("transform-rotation")).toBeNull();
  });
});
