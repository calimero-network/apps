"""Pure load generators for the perf workflows: build apply_cell_ops batches
and the expected correctness invariant. No I/O, no node calls."""
from dataclasses import dataclass


def a1(row: int, col: int) -> str:
    """0-based (row, col) -> A1 string. (0,0)->A1, (0,26)->AA1."""
    s = ""
    c = col
    while True:
        s = chr(ord("A") + (c % 26)) + s
        c = c // 26 - 1
        if c < 0:
            break
    return f"{s}{row + 1}"


def set_op(row: int, col: int, raw) -> dict:
    return {"kind": "Set", "row": row, "col": col, "raw_value": str(raw)}


@dataclass
class DataSheet:
    ops: list          # list[CellOp dict]
    grand_total_cell: tuple  # (row, col)
    input_sum: int


def financial_data_sheet(rows: int, cols: int) -> DataSheet:
    """A P&L data sheet: `rows`x`cols` numeric inputs, a per-row SUM total in the
    column after the inputs, a per-col SUM total in the row after the inputs, and
    a grand total at their intersection. Inputs are a deterministic 1..N ramp so
    the invariant is exact."""
    ops = []
    total_col = cols       # totals column sits just past the inputs
    total_row = rows       # totals row sits just past the inputs
    input_sum = 0
    n = 0
    for r in range(rows):
        for c in range(cols):
            n += 1
            input_sum += n
            ops.append(set_op(r, c, n))
    # per-row totals: =SUM(A{r}:<lastcol>{r})
    for r in range(rows):
        ops.append(set_op(r, total_col, f"=SUM({a1(r,0)}:{a1(r,cols-1)})"))
    # per-col totals: =SUM(<col>1:<col>{rows})
    for c in range(cols):
        ops.append(set_op(total_row, c, f"=SUM({a1(0,c)}:{a1(rows-1,c)})"))
    # grand total: sum of the row totals
    ops.append(set_op(total_row, total_col,
                      f"=SUM({a1(0,total_col)}:{a1(rows-1,total_col)})"))
    return DataSheet(ops=ops, grand_total_cell=(total_row, total_col), input_sum=input_sum)


# Summary sheet: cross-ref cells go in column A (rows 0..k-1); the grand total
# lives in column B, row 0 — a fixed, out-of-the-way coordinate.
SUMMARY_TOTAL_CELL = (0, 1)


def financial_summary(entries) -> list:
    """entries: list[(sheet_id, (row,col))]. One cross-ref cell per entry in
    column A referencing that sheet's grand total, then a grand SUM over those
    ref cells at SUMMARY_TOTAL_CELL."""
    ops = []
    for i, (sheet_id, (r, c)) in enumerate(entries):
        ops.append(set_op(i, 0, f"=[{sheet_id}]!{a1(r, c)}"))
    first = a1(0, 0)
    last = a1(len(entries) - 1, 0)
    ops.append(set_op(SUMMARY_TOTAL_CELL[0], SUMMARY_TOTAL_CELL[1],
                      f"=SUM({first}:{last})"))
    return ops
