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


def test_amortization_chain_shape_and_invariant():
    from generators import amortization_chain
    ops, final, last = amortization_chain(depth=4, principal=100, step=-10)
    # first cell is the literal principal; the rest reference the row above
    assert ops[0] == {"kind": "Set", "row": 0, "col": 0, "raw_value": "100"}
    assert ops[1]["raw_value"] == "=A1-10"   # A2 = A1 - 10
    assert ops[2]["raw_value"] == "=A2-10"   # A3 = A2 - 10
    assert ops[3]["raw_value"] == "=A3-10"   # A4 = A3 - 10
    assert len(ops) == 4
    # exact closed form: principal + (depth-1)*step
    assert final == 100 + 3 * (-10)          # 70
    assert last == (3, 0)


def test_amortization_chain_positive_step_uses_plus():
    from generators import amortization_chain
    ops, final, _ = amortization_chain(depth=3, principal=0, step=5)
    assert ops[1]["raw_value"] == "=A1+5"
    assert ops[2]["raw_value"] == "=A2+5"
    assert final == 0 + 2 * 5                 # 10


def test_aggregation_dashboard_shape_and_invariant():
    from generators import aggregation_dashboard
    ops, expected, cells = aggregation_dashboard(size=4)
    # 4 numeric inputs in column A rows 0..3, values 1..4
    inputs = [o for o in ops if not o["raw_value"].startswith("=")]
    assert [o["raw_value"] for o in inputs] == ["1", "2", "3", "4"]
    assert all(o["col"] == 0 for o in inputs)
    # 5 aggregation formulas over the EXPLICIT range A1:A4 (never whole-column A:A)
    formulas = {(o["row"], o["col"]): o["raw_value"] for o in ops if o["raw_value"].startswith("=")}
    assert formulas[cells["sum"]] == "=SUM(A1:A4)"
    assert formulas[cells["average"]] == "=AVERAGE(A1:A4)"
    assert formulas[cells["count"]] == "=COUNT(A1:A4)"
    assert formulas[cells["max"]] == "=MAX(A1:A4)"
    assert formulas[cells["min"]] == "=MIN(A1:A4)"
    assert not any("A:A" in v for v in formulas.values())
    # closed forms for inputs 1..N
    assert expected["sum"] == 10        # 4*5/2
    assert expected["average"] == 2.5   # (4+1)/2
    assert expected["count"] == 4
    assert expected["max"] == 4
    assert expected["min"] == 1


def test_aggregation_dashboard_large_uses_explicit_range():
    from generators import aggregation_dashboard
    ops, expected, cells = aggregation_dashboard(size=2000)
    formulas = {(o["row"], o["col"]): o["raw_value"] for o in ops if o["raw_value"].startswith("=")}
    # explicit endpoints past MAX_ROWS=1000 keep the sum exact
    assert formulas[cells["sum"]] == "=SUM(A1:A2000)"
    assert expected["sum"] == 2000 * 2001 // 2
    # input block + 5 aggregation cells
    assert len(ops) == 2000 + 5
