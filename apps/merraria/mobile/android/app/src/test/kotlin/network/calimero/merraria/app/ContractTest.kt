package network.calimero.merraria.app

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.LoginRequired
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import network.calimero.merraria.contract.MerrariaContract
import network.calimero.merraria.contract.TileEntry
import network.calimero.merraria.contract.allOverrides
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** The hand-typed client against the contract's component ABI: method names, paging and refusals in words. (Swift `ContractTests`.) */
class ContractTest {
    @Test
    fun `the method lists are the ABI's`() {
        // The app module's directory is the working directory of a unit test.
        val abi = Json.parseToJsonElement(File("../../../logic/res/abi.json").readText()).jsonObject
        // Until the component port (apps#710) is on this branch the ABI is the v1 one: nothing to compare.
        assumeTrue("logic/res/abi.json is not a component ABI yet", abi["world"] != null)
        val methods = abi["methods"]!!.jsonObject

        fun of(kind: String) = methods.filter { (it.value.jsonObject["kind"] as? JsonPrimitive)?.content == kind }.keys.sorted()
        assertEquals(MerrariaContract.CALLS, of("call"))
        assertEquals(MerrariaContract.VIEWS, of("view"))
    }

    @Test
    fun `overrides are read page by page`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.recording.handler = { call ->
                // The generated client sends an unset `option` argument as `null`, which the
                // contract reads as none, as it does a missing key.
                when ((call.args as JsonObject)["cursor"]?.takeUnless { it is JsonNull }?.let { (it as JsonPrimitive).content }) {
                    null -> Json.parseToJsonElement("""{"items":[{"k":"1,2","t":3}],"next":"a"}""")
                    "a" -> Json.parseToJsonElement("""{"items":[{"k":"3,4","t":0}],"next":"b"}""")
                    else -> Json.parseToJsonElement("""{"items":[],"next":null}""")
                }
            }
            val all = backend.merraria("w1").allOverrides()
            assertEquals(listOf(TileEntry("1,2", 3u), TileEntry("3,4", 0u)), all)
            assertEquals(listOf("getOverrides", "getOverrides", "getOverrides"), backend.recording.calls.map { it.method })
        }

    @Test
    fun `the contract's refusals read as words`() {
        fun refusal(
            code: String,
            fields: Map<String, Int> = emptyMap(),
        ) = MerrariaText.error(
            AppError(
                "refused",
                JsonObject(mapOf("code" to JsonPrimitive(code), "fields" to JsonObject(fields.mapValues { JsonPrimitive(it.value) }))),
            ),
        )
        assertEquals("This world is full (1000 players). Try another world.", refusal("WorldFull", mapOf("max" to 1000)))
        assertEquals("Too many tile changes at once (at most 512). Try again.", refusal("TooManyEdits", mapOf("max" to 512)))
        assertEquals("This world is still being created. Try again in a moment.", refusal("NoWorld"))
        assertEquals("Cancelled. Nothing was sent.", MerrariaText.error(ConfirmCancelled()))
        assertEquals("Your session ended. Sign in again.", MerrariaText.error(LoginRequired("expired")))
    }

    @Test
    fun `now is a u32`() {
        assertEquals(1_700_000_000u, u32(1_700_000_000.9))
        assertEquals(0u, u32(-1.0))
        assertEquals(UInt.MAX_VALUE, u32(1e12))
    }
}
