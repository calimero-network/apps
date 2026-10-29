package network.calimero.sheets.core

import kotlinx.coroutines.test.runTest
import network.calimero.sheets.generated.AxisSize
import network.calimero.sheets.generated.CellStyle
import network.calimero.sheets.generated.Chart
import network.calimero.sheets.generated.ChartInput
import network.calimero.sheets.generated.Member
import network.calimero.sheets.generated.Protection
import network.calimero.sheets.generated.SheetView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SpreadsheetModelTest {
    private val ctx = "ctx-1"

    private fun seeded(): FakeSheets {
        val fake = FakeSheets()
        fake.seedProject("Q3 Budget", ctx)
        fake.seedSheet("s1", "Sheet 1", 0, ctx = ctx)
        fake.seedSheet("s2", "Data", 1, ctx = ctx)
        fake.seedCell("s1", "0", "0", "Month", ctx = ctx)
        fake.seedCell("s1", "0", "1", "Sales", ctx = ctx)
        fake.seedCell("s1", "1", "0", "Jan", ctx = ctx)
        fake.seedCell("s1", "1", "1", "1200", format = "currency", ctx = ctx)
        fake.seedCell("s1", "2", "0", "Feb", ctx = ctx)
        fake.seedCell("s1", "2", "1", "=[s2]!A1*2", computed = "84", ctx = ctx)
        fake.seedCell("s2", "0", "0", "42", ctx = ctx)
        fake.styles[ctx] =
            listOf(
                CellStyle("s1", "0", "0", mapOf("bold" to "1")),
                CellStyle("s1", "9", "3", mapOf("fill" to "#ffee00")),
            )
        fake.views[ctx] = listOf(SheetView("s1", 1u, 1u, listOf(AxisSize("col", "0", 160u))))
        fake.charts[ctx] = listOf(Chart("c1", ChartInput("s1", "0", "0", "2", "1", "line", ""), fake.account))
        return fake
    }

    private fun model(fake: FakeSheets) = SpreadsheetModel(sheetsClient(fake.backend.contract, ctx), ctx)

    @Test fun `load places cells with formats styles and frozen panes`() =
        runTest {
            val m = model(seeded())
            m.load()
            val s = m.state.value
            assertEquals(LoadPhase.Loaded, s.phase)
            assertEquals("Q3 Budget", s.projectName)
            assertEquals(listOf("Sheet 1", "Data"), s.sheets.map { it.name })
            val grid = s.grid!!
            assertEquals(1, grid.frozenRows)
            assertEquals(1, grid.frozenCols)
            assertEquals(160.0, grid.width(0), 0.0)
            assertEquals("$1,200.00", grid.cells[GridPos(1, 1)]?.text)
            assertTrue(grid.cells[GridPos(0, 0)]!!.look.bold)
            assertEquals(0xFFEE00, grid.cells[GridPos(9, 3)]?.look?.fill)
            val formula = grid.cells[GridPos(2, 1)]!!
            assertEquals("84", formula.text)
            assertEquals("=Data!A1*2", formula.raw)
            assertNotNull(m.editBlock(formula.pos))
        }

    @Test fun `switching tabs`() =
        runTest {
            val m = model(seeded())
            m.load()
            m.select(GridPos(1, 1))
            m.selectSheet("s2")
            assertEquals("s2", m.state.value.activeSheetId)
            assertNull(m.state.value.selected)
            assertEquals(
                "42",
                m.state.value.grid
                    ?.cells
                    ?.get(GridPos(0, 0))
                    ?.text,
            )
        }

    @Test fun `charts read their range`() =
        runTest {
            val m = model(seeded())
            m.load()
            val chart = m.sheetCharts().first()
            assertEquals("line", chart.kind)
            assertEquals("A1:B3", chart.range)
            assertEquals("Sales", chart.title)
            assertEquals(listOf("Jan", "Feb"), chart.model.labels)
            assertEquals(
                listOf(1200.0, 84.0),
                chart.model.series
                    .first()
                    .values,
            )
        }

    @Test fun `editing a plain value`() =
        runTest {
            val fake = seeded()
            val m = model(fake)
            m.load()
            m.setValue("950", GridPos(1, 1))
            assertEquals("950", fake.cell("s1", "1", "1", ctx)?.rawValue)
            assertEquals(
                "950",
                m.state.value.grid
                    ?.cells
                    ?.get(GridPos(1, 1))
                    ?.computed,
            )
            m.setValue("hello", GridPos(20, 4))
            assertEquals("hello", fake.cell("s1", "20", "4", ctx)?.rawValue)
            m.setValue("", GridPos(20, 4))
            assertNull(fake.cell("s1", "20", "4", ctx))
        }

    @Test fun `formulas and linked sheets are refused`() =
        runTest {
            val fake = seeded()
            fake.seedSheet("s3", "Linked", 2, "Ledger", ctx)
            val m = model(fake)
            m.load()
            try {
                m.setValue("=1+1", GridPos(5, 5))
                fail("expected a refusal")
            } catch (e: SheetsException) {
                assertEquals("Formulas are written in the web app. Enter a plain value here.", e.message)
            }
            m.selectSheet("s3")
            assertEquals("This sheet is linked from Ledger, so it is read-only here.", m.editBlock(GridPos(0, 0)))
        }

    @Test fun `viewers cannot edit`() =
        runTest {
            val fake = seeded()
            fake.members[ctx] = listOf(Member(fake.account, "Ana", 1uL, 1uL, fake.account, "viewer"))
            val m = model(fake)
            m.load()
            assertEquals("viewer", m.state.value.role)
            assertEquals("You are a viewer in this workbook.", m.editBlock(GridPos(0, 0)))
            assertFalse(m.state.value.canComment)
        }

    @Test fun `protected range`() =
        runTest {
            val fake = seeded()
            fake.members[ctx] = listOf(Member(fake.account, "Ana", 1uL, 1uL, fake.account, "editor"))
            fake.protections[ctx] = listOf(Protection("p1", "s1", "0", "0", "1", "1", "Totals", emptyList(), "zz"))
            val m = model(fake)
            m.load()
            assertEquals("Protected: Totals", m.editBlock(GridPos(1, 0)))
            assertNull(m.editBlock(GridPos(3, 0)))
        }

    @Test fun `comments threads resolve and markers`() =
        runTest {
            val m = model(seeded())
            m.load()
            val pos = GridPos(1, 1)
            m.addComment("Is this final?", pos)
            assertEquals(
                setOf(pos),
                m.state.value.grid
                    ?.commented,
            )
            val thread = m.threadsAt(pos).first()
            assertEquals("B2", m.location(thread.root))
            m.reply(thread, "Yes")
            assertEquals(
                listOf("Yes"),
                m
                    .threadsAt(pos)
                    .first()
                    .replies
                    .map { it.text },
            )
            assertEquals("You", m.nameOf(thread.root.author))
            m.setResolved(thread, true)
            assertTrue(m.openThreads().isEmpty())
            assertEquals(
                emptySet<GridPos>(),
                m.state.value.grid
                    ?.commented,
            )
            m.editComment(thread.root, "Is this the final number?")
            assertEquals(
                "Is this the final number?",
                m
                    .threadsAt(pos)
                    .first()
                    .root.text,
            )
            m.deleteComment(thread.root)
            assertTrue(m.threadsAt(pos).isEmpty())
        }

    @Test fun `a failed write keeps the content and reports it`() =
        runTest {
            val fake = seeded()
            val m = model(fake)
            m.load()
            fake.failWrites = SheetsException("Read-only")
            try {
                m.setValue("1", GridPos(1, 1))
                fail("expected a failure")
            } catch (e: SheetsException) {
                assertEquals("Read-only", e.message)
            }
            assertEquals(
                "1200",
                m.state.value.grid
                    ?.cells
                    ?.get(GridPos(1, 1))
                    ?.computed,
            )
        }
}
