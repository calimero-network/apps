import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import NumberField, { parseNumeric } from "./NumberField";

/**
 * The reported bug: "rotation and border radius don't work when it's 0 — I have
 * to put the cursor in front of the 0 and add a 2, or use the up/down keys".
 *
 * That is what a controlled `<input type="number">` whose onChange does
 * `Number(e.target.value)` does: clearing the field yields "", `Number("")` is
 * 0, and React writes the 0 straight back, so the field can never be emptied and
 * the caret jumps. Every one of these tests fails against that implementation.
 */

/** A field wired the way the inspector wires it: value comes back from state. */
function Harness({ initial = 0, ...props }: { initial?: number } & Partial<React.ComponentProps<typeof NumberField>>) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <NumberField testId="field" value={value} onChange={setValue} {...props} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const field = () => screen.getByTestId("field") as HTMLInputElement;
const value = () => screen.getByTestId("value").textContent;

describe("NumberField", () => {
  it("lets a 0 be cleared and replaced, which is the whole bug", () => {
    render(<Harness initial={0} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "" } });
    // The field stays empty instead of snapping back to "0".
    expect(field().value).toBe("");
    fireEvent.change(field(), { target: { value: "45" } });
    expect(value()).toBe("45");
  });

  it("keeps a partial minus sign while it is being typed", () => {
    render(<Harness initial={0} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "-" } });
    expect(field().value).toBe("-");
    expect(value()).toBe("0"); // nothing committed yet
    fireEvent.change(field(), { target: { value: "-30" } });
    expect(value()).toBe("-30");
  });

  it("does not rewrite a trailing decimal point", () => {
    render(<Harness initial={0} precision={2} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "1." } });
    expect(field().value).toBe("1.");
  });

  it("restores the committed value when a blank field is blurred", () => {
    render(<Harness initial={12} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.blur(field());
    expect(field().value).toBe("12");
    expect(value()).toBe("12");
  });

  it("steps with the arrow keys — ×10 with Shift", () => {
    render(<Harness initial={0} />);
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(value()).toBe("1");
    fireEvent.keyDown(field(), { key: "ArrowUp", shiftKey: true });
    expect(value()).toBe("11");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(value()).toBe("10");
  });

  it("clamps to the range and shows the clamp", () => {
    render(<Harness initial={0} min={0} max={60} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "500" } });
    expect(value()).toBe("60");
    expect(field().value).toBe("60");
  });

  it("never emits a value below its minimum", () => {
    render(<Harness initial={10} min={1} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "0" } });
    expect(value()).toBe("1");
  });

  it("rounds to the requested precision", () => {
    render(<Harness initial={0} precision={0} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "12.6" } });
    expect(value()).toBe("13");
  });

  it("takes an external change while it is not focused", () => {
    function Outside() {
      const [v, setV] = useState(5);
      return (
        <>
          <NumberField testId="field" value={v} onChange={setV} />
          <button onClick={() => setV(99)}>move</button>
        </>
      );
    }
    render(<Outside />);
    fireEvent.click(screen.getByText("move"));
    expect(field().value).toBe("99");
  });

  it("does not fire onChange when the text has not changed the value", () => {
    const onChange = vi.fn();
    render(<NumberField testId="field" value={7} onChange={onChange} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "7" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps Escape inside the field so the canvas does not delete the element", () => {
    const onKey = vi.fn();
    render(
      <div onKeyDown={onKey}>
        <Harness initial={3} />
      </div>,
    );
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "9" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onKey).not.toHaveBeenCalled();
  });

  it("shows the suffix without putting it in the value", () => {
    render(<Harness initial={40} suffix="%" />);
    expect(field().value).toBe("40");
    expect(screen.getByText("%")).toBeTruthy();
  });
});

describe("parseNumeric", () => {
  it("rejects the intermediate states people type", () => {
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric("-")).toBeNull();
    expect(parseNumeric(".")).toBeNull();
    expect(parseNumeric("abc")).toBeNull();
  });

  it("accepts numbers, including a comma decimal", () => {
    expect(parseNumeric("12")).toBe(12);
    expect(parseNumeric(" -4.5 ")).toBe(-4.5);
    expect(parseNumeric("3,5")).toBe(3.5);
  });
});
