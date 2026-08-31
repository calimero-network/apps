import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Select from "./Select";
import Slider from "./Slider";
import ColorField, { normalizeHex } from "./ColorField";
import { Checkbox, Segmented, Switch } from "./Toggle";

/**
 * The inspector controls. These are custom-painted rather than native, so the
 * behaviour a native element gave for free — keyboard operation, an accessible
 * checked state, a value that survives being typed into — has to be tested.
 */

describe("Select", () => {
  const OPTIONS = [
    { value: "serif", label: "serif" },
    { value: "monospace", label: "monospace" },
    { value: "Georgia", label: "Georgia" },
  ];

  function Harness({ onChange = () => {} }: { onChange?: (v: string) => void }) {
    const [value, setValue] = useState("serif");
    return (
      <Select
        testId="font"
        value={value}
        options={OPTIONS}
        onChange={(v) => { setValue(v); onChange(v); }}
      />
    );
  }

  it("shows the selected option and opens on click", () => {
    render(<Harness />);
    expect(screen.getByTestId("font").textContent).toContain("serif");
    expect(screen.queryByTestId("font-menu")).toBeNull();
    fireEvent.click(screen.getByTestId("font"));
    expect(screen.getByTestId("font-menu")).toBeTruthy();
  });

  it("picks an option with the mouse", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByTestId("font"));
    fireEvent.click(screen.getByText("Georgia"));
    expect(onChange).toHaveBeenCalledWith("Georgia");
    expect(screen.queryByTestId("font-menu")).toBeNull();
  });

  it("is operable from the keyboard", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByTestId("font");
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // opens
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // serif → monospace
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("monospace");
  });

  it("jumps to an option by typing its first letters", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByTestId("font");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "g" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Georgia");
  });

  it("closes on Escape without letting it reach the canvas", () => {
    const onKey = vi.fn();
    render(<div onKeyDown={onKey}><Harness /></div>);
    const trigger = screen.getByTestId("font");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByTestId("font-menu")).toBeNull();
    expect(onKey).not.toHaveBeenCalled();
  });

  it("reports its state to assistive tech", () => {
    render(<Harness />);
    const trigger = screen.getByTestId("font");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });
});

describe("Checkbox and Switch", () => {
  it("keeps a real checkbox underneath, so a label click still toggles it", () => {
    const onChange = vi.fn();
    render(<Checkbox testId="fill" checked={false} label="Fill" onChange={onChange} />);
    fireEvent.click(screen.getByText("Fill"));
    expect(onChange).toHaveBeenCalledWith(true);
    expect((screen.getByTestId("fill") as HTMLInputElement).type).toBe("checkbox");
  });

  it("does not fire when disabled", () => {
    const onChange = vi.fn();
    render(<Checkbox testId="fill" checked={false} label="Fill" disabled onChange={onChange} />);
    fireEvent.click(screen.getByTestId("fill"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the switch announces itself as a switch", () => {
    render(<Switch testId="shadow" checked onChange={() => {}} />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect((screen.getByTestId("shadow") as HTMLInputElement).checked).toBe(true);
  });
});

describe("Segmented", () => {
  const SEGMENTS = [
    { value: "left", content: "L", testId: "seg-left" },
    { value: "center", content: "C", testId: "seg-center" },
    { value: "right", content: "R", testId: "seg-right" },
  ];

  it("marks the active segment with aria-checked", () => {
    render(<Segmented value="center" segments={SEGMENTS} onChange={() => {}} />);
    expect(screen.getByTestId("seg-center").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("seg-left").getAttribute("aria-checked")).toBe("false");
  });

  it("is a radio group", () => {
    render(<Segmented value="left" segments={SEGMENTS} onChange={() => {}} ariaLabel="Align" />);
    expect(screen.getByRole("radiogroup", { name: "Align" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("fires even for the already-active segment, so it can act as a toggle", () => {
    const onChange = vi.fn();
    render(<Segmented value="left" segments={SEGMENTS} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("seg-left"));
    expect(onChange).toHaveBeenCalledWith("left");
  });
});

describe("Slider", () => {
  it("paints the filled portion from the value", () => {
    render(<Slider testId="opacity" value={25} onChange={() => {}} />);
    const input = screen.getByTestId("opacity");
    expect(input.style.getPropertyValue("--fill")).toBe("25%");
  });

  it("reports numbers, not strings", () => {
    const onChange = vi.fn();
    render(<Slider testId="opacity" value={25} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("opacity"), { target: { value: "80" } });
    expect(onChange).toHaveBeenCalledWith(80);
  });
});

describe("ColorField", () => {
  it("expands and commits a typed hex", () => {
    const onChange = vi.fn();
    render(<ColorField testId="fill" value="#4f8ef7" onChange={onChange} />);
    const hex = screen.getByTestId("fill-hex");
    fireEvent.change(hex, { target: { value: "#abc" } });
    fireEvent.blur(hex, { target: { value: "#abc" } });
    expect(onChange).toHaveBeenCalledWith("#aabbcc");
  });

  it("ignores text that is not a colour", () => {
    const onChange = vi.fn();
    render(<ColorField testId="fill" value="#4f8ef7" onChange={onChange} />);
    fireEvent.blur(screen.getByTestId("fill-hex"), { target: { value: "not a colour" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives the native picker a valid hex even when the value is rgba()", () => {
    render(<ColorField testId="shadow" value="rgba(0,0,0,0.3)" onChange={() => {}} />);
    // <input type="color"> silently resets anything it cannot parse.
    expect((screen.getByTestId("shadow") as HTMLInputElement).value).toBe("#4f8ef7");
  });

  it("shows nothing rather than a colour when unset", () => {
    render(<ColorField testId="fill" value="transparent" onChange={() => {}} />);
    expect((screen.getByTestId("fill-hex") as HTMLInputElement).value).toBe("");
  });
});

describe("normalizeHex", () => {
  it("accepts 3- and 6-digit hex, with or without the hash", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("4f8ef7")).toBe("#4f8ef7");
    expect(normalizeHex(" #4F8EF7 ")).toBe("#4f8ef7");
  });

  it("rejects everything else", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("rgba(0,0,0,0.3)")).toBeNull();
  });
});
