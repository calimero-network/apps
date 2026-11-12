package network.calimero.pixart

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import network.calimero.pixart.core.pixartClient
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The client speaks the component contract's wire (`logic/res/abi.json`): camelCase methods and
 * arguments, top-level u64 / i64 arguments as decimal strings. (iOS `WireTests`.)
 */
class WireTest {
    @Test
    fun `integer arguments go out as decimal strings`() =
        runTest {
            val backend = InMemoryAppBackend(account = "acct_1")
            val client = backend.pixartClient("app-1")
            runCatching { client.updateCursor(-12, 9_007_199_254_740_993, 42uL) }
            val cursor =
                backend.recording
                    .calls("updateCursor")
                    .single()
                    .args.jsonObject
            assertEquals(JsonPrimitive("-12"), cursor["x"])
            assertEquals(JsonPrimitive("9007199254740993"), cursor["y"])
            assertEquals(JsonPrimitive("42"), cursor["updatedAt"])

            runCatching { client.updateLayer("l1", visible = false, x = 5, updatedAt = 7uL) }
            val call = backend.recording.calls("updateLayer").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals(JsonPrimitive("5"), call.args.jsonObject["x"])
            assertEquals("an unset optional goes out as null, which the contract reads as none", JsonNull, call.args.jsonObject["y"])
            assertEquals(JsonPrimitive(false), call.args.jsonObject["visible"])

            runCatching { client.getLayers() }
            assertEquals(
                RecordedContractCall.Path.QUERY,
                backend.recording
                    .calls("getLayers")
                    .single()
                    .path,
            )
        }
}
