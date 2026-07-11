import re
from generators import (
    a1, set_op, financial_data_sheet, financial_summary, SUMMARY_TOTAL_CELL,
)


def test_a1_conversion():
    assert a1(0, 0) == "A1"
    assert a1(0, 25) == "Z1"
    assert a1(0, 26) == "AA1"
    assert a1(4, 2) == "C5"


def test_set_op_shape():
    assert set_op(1, 2, 7) == {"kind": "Set", "row": 1, "col": 2, "raw_value": "7"}


def test_data_sheet_counts_and_sum():
    # 3x4 inputs → rows=3,cols=4. Layout: inputs in rows 0..2 x cols 0..3;
    # per-row total in col 4; per-col total in row 3; grand total at (3,4).
    ds = financial_data_sheet(rows=3, cols=4)
    kinds = [o["kind"] for o in ds.ops]
    assert set(kinds) == {"Set"}
    inputs = [o for o in ds.ops if not o["raw_value"].startswith("=")]
    formulas = [o for o in ds.ops if o["raw_value"].startswith("=")]
    assert len(inputs) == 12          # 3*4 numeric inputs
    assert len(formulas) == 3 + 4 + 1  # 3 row totals + 4 col totals + grand total
    # input_sum equals the arithmetic sum of the numeric inputs
    assert ds.input_sum == sum(int(o["raw_value"]) for o in inputs)
    assert ds.grand_total_cell == (3, 4)
    # each row-total is a SUM over that row's input range
    row0_total = next(o for o in ds.ops if o["row"] == 0 and o["col"] == 4)
    assert row0_total["raw_value"] == "=SUM(A1:D1)"


def test_summary_cross_refs():
    ops = financial_summary([("sheet-abc", (3, 4)), ("sheet-def", (5, 2))])
    formulas = {(o["row"], o["col"]): o["raw_value"] for o in ops}
    # one cross-ref per entry, using bracket-id form at the entry's grand-total cell
    assert formulas[(0, 0)] == "=[sheet-abc]!E4"
    assert formulas[(1, 0)] == "=[sheet-def]!C6"
    # summary grand total sums the two ref cells and lives at SUMMARY_TOTAL_CELL
    assert formulas[SUMMARY_TOTAL_CELL].startswith("=SUM(")
    assert "A1" in formulas[SUMMARY_TOTAL_CELL] and "A2" in formulas[SUMMARY_TOTAL_CELL]
