package network.calimero.sheets.core

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import network.calimero.sheets.generated.Cell
import network.calimero.sheets.generated.Member
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The client speaks the component contract's wire (`logic/res/abi.json`): camelCase method and
 * argument names, u64 values as decimal strings. (iOS `WireTests`.)
 */
class WireTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun `calls use camelCase methods and arguments`() =
        runTest {
            val backend = InMemoryAppBackend(account = "acct_1")
            val client = sheetsClient(backend.contract, "app-1")
            runCatching { client.setCell("s1", "r1", "c1", "42") }
            val call = backend.recording.calls("setCell").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals(
                JsonObject(
                    mapOf("sheetId" to JsonPrimitive("s1"), "rowId" to JsonPrimitive("r1"), "colId" to JsonPrimitive("c1"), "rawValue" to JsonPrimitive("42")),
                ),
                call.args,
            )
            runCatching { client.getAllCells() }
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("getAllCells")
                    .single()
                    .path,
            )
        }

    @Test fun `u64 goes out as a decimal string`() =
        runTest {
            val backend = InMemoryAppBackend(account = "acct_1")
            runCatching { sheetsClient(backend.contract, "app-1").getActivity(ULong.MAX_VALUE, 5u) }
            val args =
                backend.recording
                    .calls("getActivity")
                    .single()
                    .args.jsonObject
            assertEquals(JsonPrimitive("18446744073709551615"), args["since"])
            assertEquals(JsonPrimitive(5), args["limit"])
        }

    @Test fun `answers read u64 from decimal strings`() {
        val cell =
            json.decodeFromString(
                Cell.serializer(),
                """{"id":"s1|r|c","sheet_id":"s1","row_id":"r","col_id":"c","raw_value":"7","computed_value":"7",
                "format":"","updated_at":"1700000000000000000","last_editor":"acct_1","last_edited_at":"5"}""",
            )
        assertEquals(1_700_000_000_000_000_000uL, cell.updatedAt)
        assertEquals(5uL, cell.lastEditedAt)
        // A bare number still reads.
        val member =
            json.decodeFromString(
                Member.serializer(),
                """{"id":"acct_1","nickname":"Ada","joined_at":3,"updated_at":"4","account":"acct_1","role":"owner"}""",
            )
        assertEquals(3uL, member.joinedAt)
        assertEquals(4uL, member.updatedAt)
    }
}
