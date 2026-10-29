package network.calimero.sheets.core

import network.calimero.sheets.generated.AxisEntryView
import network.calimero.sheets.generated.AxisSize
import network.calimero.sheets.generated.SheetLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SheetsFormatTest {
    @Test fun `number formats match the web`() {
        assertEquals("1,234.50", CellFormat.display("1234.5", "number"))
        assertEquals("1,235", CellFormat.display("1234.5", "number:0"))
        assertEquals("$1,234.50", CellFormat.display("1234.5", "currency"))
        assertEquals("€1,235", CellFormat.display("1234.5", "currency:EUR:0"))
        assertEquals("25.6%", CellFormat.display("0.256", "percent:1"))
        assertEquals("25%", CellFormat.display("0.25", "percent"))
        assertEquals("hello", CellFormat.display("hello", "number"))
        assertEquals("#REF!", CellFormat.display("#REF!", "currency"))
        assertEquals("", CellFormat.display("", "number"))
        assertEquals("42", CellFormat.display("42", ""))
    }

    @Test fun `date formats`() {
        assertEquals("2024-03-05", CellFormat.display("2024-03-05", "date"))
        assertEquals("03/05/2024", CellFormat.display("2024-03-05", "date:us"))
        assertEquals("05/03/2024", CellFormat.display("2024-03-05", "date:eu"))
        assertEquals("5 March 2024", CellFormat.display("2024-03-05", "date:long"))
        assertEquals("soon", CellFormat.display("soon", "date"))
    }

    @Test fun `describe and look`() {
        assertEquals("Automatic", CellFormat.describe(""))
        assertEquals("Currency (EUR, 1 decimal)", CellFormat.describe("currency:eur:1"))
        assertEquals("Date (DD/MM/YYYY)", CellFormat.describe("date:eu"))
        val look = CellLook.of(mapOf("bold" to "1", "color" to "#ff0000", "fill" to "#0f0", "align" to "center", "wrap" to ""))
        assertTrue(look.bold)
        assertEquals(0xFF0000, look.color)
        assertEquals(0x00FF00, look.fill)
        assertEquals("center", look.align)
        assertFalse(look.wrap)
        assertTrue(CellLook.of(emptyMap()).isPlain)
    }

    @Test fun ago() {
        val now = 1_700_000_000_000L

        fun ns(secondsAgo: Long) = (now - secondsAgo * 1000) * 1_000_000
        assertEquals("just now", SheetsFormat.ago(ns(10), now))
        assertEquals("5 min ago", SheetsFormat.ago(ns(300), now))
        assertEquals("2 h ago", SheetsFormat.ago(ns(7200), now))
        assertEquals("", SheetsFormat.ago(0, now))
    }

    @Test fun `chart model`() {
        val data = listOf(listOf("Month", "Sales", "Cost"), listOf("Jan", "10", "4"), listOf("Feb", "x", "5"))
        val m = ChartModel.of(0, 0, 2, 2) { r, c -> data[r][c] }
        assertEquals(listOf("Jan", "Feb"), m.labels)
        assertEquals(listOf("Sales", "Cost"), m.series.map { it.name })
        assertEquals(listOf(10.0, null), m.series[0].values)
        val single = ChartModel.of(1, 1, 2, 1) { r, c -> data[r][c] }
        assertEquals(listOf("2", "3"), single.labels)
        assertEquals(listOf("B"), single.series.map { it.name })
        assertEquals(listOf(0.0, 2.0, 4.0, 6.0, 8.0, 10.0), ChartModel.niceTicks(0.0, 9.0))
        assertEquals("1.5M", ChartModel.formatTick(1_500_000.0))
        assertEquals("1,234.57", ChartModel.formatTick(1234.567))
    }

    @Test fun `column labels`() {
        assertEquals("A", A1.column(0))
        assertEquals("Z", A1.column(25))
        assertEquals("AA", A1.column(26))
        assertEquals("ZZ", A1.column(701))
        assertEquals(26, A1.columnIndex("AA"))
        assertEquals("B3", A1.cell(2, 1))
        assertEquals("Data!", A1.sheetPrefix("Data"))
        assertEquals("'Q3 Budget'!", A1.sheetPrefix("Q3 Budget"))
        assertEquals("'Bob''s'!", A1.sheetPrefix("Bob's"))
    }

    @Test fun `axis order`() {
        val implicit = AxisOrder(emptyList(), 5)
        assertEquals(listOf("0", "1", "2", "3", "4"), implicit.ids)
        assertNull(implicit.position("03"))
        val moved = AxisOrder(listOf(AxisEntryView("k1", "50000000015", false), AxisEntryView("0", "", true)), 4)
        assertEquals(listOf("1", "k1", "2", "3"), moved.ids)
    }

    @Test fun `formula display`() {
        val plain = SheetOrder(null)
        val moved = SheetOrder(SheetLayout("s1", listOf(AxisEntryView("k1", "4", false)), emptyList()))

        fun show(f: String) =
            FormulaDisplay.display(f, "s1", { if (it == "s1") moved else plain }) {
                when (it) {
                    "s2" -> "Q3 Budget"
                    "s3" -> "Data"
                    else -> null
                }
            }
        assertEquals("=SUM(A2:A4)", show("=SUM(A1:A3)"))
        assertEquals("=A1*2", show("={r=k1;c=0}*2"))
        assertEquals("=\$B\$1+\$B\$2", show("={\$r=k1;\$c=1}+\$B\$1"))
        assertEquals("='Q3 Budget'!B2+Data!A1", show("=[s2]!B2+[s3]!A1"))
        assertEquals("=CONCAT(\"A1\", B2)", show("=CONCAT(\"A1\", B1)"))
        assertEquals("=LOG10(A2)", show("=LOG10(A1)"))
        assertEquals("=SUM(B:B)", show("=SUM(B:B)"))
        assertEquals("=#REF!", show("={r=gone;c=0}"))
        assertEquals("plain", show("plain"))
    }

    @Test fun `grid metrics`() {
        val cell = GridCell(GridPos(4, 2), "4", "2", "x", "x", "", "x", CellLook(), "", 0)
        val grid = SheetGrid("s", SheetOrder(null), mapOf(cell.pos to cell), listOf(AxisSize("col", "1", 40u)), 1, 1)
        assertEquals(60, grid.rowCount)
        assertEquals(12, grid.colCount)
        assertEquals(40.0, grid.width(1), 0.0)
        assertEquals(140.0, grid.colOffsets[2], 0.0)
        assertEquals(1, grid.colAt(139.0))
        assertEquals(2, grid.colAt(140.0))
        assertEquals(1, grid.rowAt(47.9))
        assertEquals(24.0, grid.frozenHeight, 0.0)
    }
}
