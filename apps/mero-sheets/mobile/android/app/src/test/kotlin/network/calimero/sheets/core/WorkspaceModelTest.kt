package network.calimero.sheets.core

import com.calimero.mero.app.AppNamespace
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.UnknownHostException

class WorkspaceModelTest {
    private fun model(
        fake: FakeSheets,
        store: SheetsStore = MemorySheetsStore(),
    ) = WorkspaceModel(fake.backend, fake.backend.applicationId, store)

    @Test fun `load opens the remembered workspace and names spreadsheets from the workbook`() =
        runTest {
            val fake = FakeSheets()
            val a = "1".repeat(64)
            val b = "2".repeat(64)
            fake.backend.namespaces = listOf(AppNamespace(a, "Alpha", "app"), AppNamespace(b, "Beta", "app"))
            fake.backend.rootContexts = mapOf(b to listOf("ctx-1", "ctx-2"))
            fake.seedProject("Q3 Budget", "ctx-1")
            val store = MemorySheetsStore().apply { activeWorkspace = b }
            val m = model(fake, store)
            m.load()
            val s = m.state.value
            assertEquals(LoadPhase.Loaded, s.phase)
            assertEquals(listOf("Alpha", "Beta"), s.workspaces.map { it.name })
            assertEquals(b, s.activeWorkspaceId)
            assertEquals(listOf("Q3 Budget", "Untitled · ctx-2"), s.spreadsheets.map { it.name })
            assertEquals(listOf(false, true), s.spreadsheets.map { it.unnamed })
        }

    @Test fun `create a workspace then a spreadsheet inits the workbook`() =
        runTest {
            val fake = FakeSheets()
            val m = model(fake)
            m.load()
            assertTrue(
                m.state.value.workspaces
                    .isEmpty(),
            )
            assertNull(m.createWorkspace("  Finance "))
            assertEquals(
                "Finance",
                m.state.value.activeWorkspace
                    ?.name,
            )
            assertTrue("foundNamespace Finance" in fake.backend.log)
            val id = m.createSpreadsheet(" Q3 Budget ")
            assertEquals("Q3 Budget", fake.project(id))
            assertEquals(listOf("Sheet 1"), fake.sheetNames(id))
            assertEquals(
                "Q3 Budget",
                m.state.value
                    .spreadsheet(id)
                    ?.name,
            )
            assertEquals(JsonObject(emptyMap()), fake.backend.initArgs[id])
        }

    @Test fun `create needs a name`() =
        runTest {
            val m = model(FakeSheets())
            try {
                m.createSpreadsheet(" ")
                fail("expected a failure")
            } catch (e: SheetsException) {
                assertEquals("Give the spreadsheet a name.", e.message)
            }
        }

    @Test fun `hosting notice when not hosted`() =
        runTest {
            val fake = FakeSheets()
            fake.backend.haEnabled = false
            assertNotNull(model(fake).createWorkspace("Solo"))
        }

    @Test fun `invite link round trips and join opens the workspace`() =
        runTest {
            val inviter = FakeSheets()
            val m = model(inviter)
            m.createWorkspace("Finance")
            val id = m.createSpreadsheet("Q3 Budget")
            val link = m.inviteLink(m.state.value.spreadsheet(id))
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-sheets/join?invitation="))
            val parsed = SheetsInvitation.parse(link)!!
            assertEquals("Finance", parsed.workspaceName)
            assertEquals(id, parsed.contextId)
            assertEquals("Q3 Budget", parsed.spreadsheetName)

            val joiner = FakeSheets(account = "cd".repeat(32))
            val store = MemorySheetsStore()
            val other = model(joiner, store)
            other.join(parsed)
            assertEquals(parsed.namespaceId, other.state.value.activeWorkspaceId)
            assertEquals(parsed.namespaceId, store.activeWorkspace)
            assertTrue(other.state.value.isSyncing)
        }

    @Test fun `failure is worded`() =
        runTest {
            val fake = FakeSheets()
            fake.backend.failure = UnknownHostException("relay")
            val m = model(fake)
            m.load()
            assertEquals(LoadPhase.Failed("You are offline. Check your connection and try again."), m.state.value.phase)
        }

    @Test fun `ensure member joins when not a member`() =
        runTest {
            val fake = FakeSheets()
            model(fake).ensureMember("ctx-9")
            assertTrue("joinContext ctx-9" in fake.backend.log)
        }
}
