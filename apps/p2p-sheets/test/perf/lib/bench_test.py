from bench import chunked, format_summary


def test_chunked_splits_evenly_and_remainder():
    assert chunked([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]
    assert chunked([], 2) == []
    assert chunked([1, 2], 5) == [[1, 2]]


def test_format_summary_is_markdown_table_with_rows():
    rows = [
        {"size": "small", "input_cells": 12, "formula_cells": 8,
         "apply_ms": 5.1, "derive_active_ms": 1.2, "derive_all_ms": 1.4,
         "sync_ms": 30.0, "correct": True},
    ]
    out = format_summary(rows)
    assert "| size | input_cells |" in out          # header
    assert "| small | 12 |" in out                    # row
    assert len(out.splitlines()) == 3                  # header + separator + 1 row
