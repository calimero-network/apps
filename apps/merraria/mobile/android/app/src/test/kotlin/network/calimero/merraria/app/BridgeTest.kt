package network.calimero.merraria.app

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.merraria.generated.PlayerView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BridgeTest {
    // ---- page -> app ---------------------------------------------------------------------------

    @Test
    fun `decodes contract requests`() {
        assertEquals(
            PageMessage.Request(7, BridgeOp.EXECUTE, "set_tiles", """{"edits":[{"x":1,"y":-2,"t":0}],"now":5}"""),
            PageMessage.decode("""{"type":"request","id":7,"op":"execute","method":"set_tiles","args":{"edits":[{"x":1,"y":-2,"t":0}],"now":5}}"""),
        )
    }

    @Test
    fun `decodes the config request without a method`() {
        assertEquals(PageMessage.Request(1, BridgeOp.CONFIG, "", "{}"), PageMessage.decode("""{"type":"request","id":1,"op":"config"}"""))
    }

    @Test
    fun `decodes hud status fatal and left`() {
        assertEquals(
            PageMessage.Hud(2, listOf(HudSlot(1, "dirt", 0x8A5A33, 4), HudSlot(3, "stone", 0x7E8288, 0))),
            PageMessage.decode(
                """{"type":"hud","sel":2,"slots":[{"id":1,"name":"dirt","color":"#8a5a33","count":4},{"id":3,"name":"stone","color":"7e8288","count":0}]}""",
            ),
        )
        assertEquals(PageMessage.Connected, PageMessage.decode("""{"type":"status","state":"connected"}"""))
        assertEquals(PageMessage.Fatal("gone"), PageMessage.decode("""{"type":"fatal","message":"gone"}"""))
        assertEquals(PageMessage.Left, PageMessage.decode("""{"type":"left"}"""))
    }

    @Test
    fun `refuses malformed messages`() {
        assertNull(PageMessage.decode("not json"))
        assertNull(PageMessage.decode("""{"type":"request","id":1,"op":"delete","method":"x"}"""))
        assertNull(PageMessage.decode("""{"type":"request","op":"query","method":"world_meta"}"""))
        assertNull(PageMessage.decode("""{"type":"request","id":1,"op":"query"}"""))
        assertNull(PageMessage.decode("""{"type":"status","state":"other"}"""))
        assertNull(PageMessage.decode("""{"type":"mystery"}"""))
    }

    // ---- app -> page ---------------------------------------------------------------------------

    @Test
    fun `encodes responses`() {
        assertEquals(
            """{"type":"response","id":3,"ok":true,"value":[{"k":"1,2","t":0}]}""",
            AppMessage.success(3, """[{"k":"1,2","t":0}]""").json,
        )
        assertEquals("""{"type":"response","id":4,"ok":true,"value":null}""", AppMessage.success(4, "").json)
        assertEquals("""{"type":"response","id":5,"ok":true,"value":"not json"}""", AppMessage.success(5, "not json").json)
        assertEquals(
            """{"type":"response","id":6,"ok":false,"error":"{\"type\":\"Uninitialized\"} \"quoted\""}""",
            AppMessage.failure(6, """{"type":"Uninitialized"} "quoted"""").json,
        )
    }

    @Test
    fun `encodes control messages`() {
        assertEquals(
            """{"type":"input","move":-1,"jump":true,"jumpPressed":true,"mine":false,"place":true}""",
            AppMessage.Input(GameInput(move = -1, jump = true, jumpPressed = true, place = true)).json,
        )
        assertEquals("""{"type":"target","x":120,"y":64.5}""", AppMessage.Target(120.0, 64.5).json)
        assertEquals("""{"type":"select","slot":3}""", AppMessage.Select(3).json)
        assertEquals("""{"type":"zoom","value":1.3}""", AppMessage.Zoom(1.3).json)
        assertEquals("""{"type":"pause"}""", AppMessage.Pause.json)
        assertEquals("""{"type":"leave"}""", AppMessage.Leave.json)
        assertEquals("""{"type":"event","kind":"StateMutation"}""", AppMessage.Event("StateMutation").json)
        assertEquals("""window.meroBridge && window.meroBridge.receive({"type":"pause"});""", AppMessage.Pause.script)
    }

    @Test
    fun `encodes config`() {
        assertEquals("""{"contextId":"ctx","name":"Ada \"A\"","zoom":1}""", GameConfig("ctx", "Ada \"A\"", 1.0).json)
    }

    // ---- dispatch through the generated client ---------------------------------------------------

    private fun dispatcher(): Pair<BridgeDispatcher, InMemoryAppBackend> {
        val backend = InMemoryAppBackend()
        backend.recording.handler = { call ->
            when (call.method) {
                "get_overrides" ->
                    JsonArray(
                        listOf(
                            buildJsonObject {
                                put("k", "4,5")
                                put("t", 3)
                            },
                        ),
                    )
                "world_meta" ->
                    buildJsonObject {
                        put("name", "surface")
                        put("seed", 1337)
                        put("createdAt", 10)
                    }
                "join" ->
                    buildJsonObject {
                        put("id", "dev1")
                        put("name", "Ada")
                        put("x", 1.5)
                        put("y", 2.0)
                        put("dir", 1.0)
                        put("sel", 0)
                        put("action", "idle")
                        put("online", true)
                    }
                "set_tiles" -> JsonPrimitive(1)
                else -> JsonNull as JsonElement
            }
        }
        return BridgeDispatcher(backend.merraria("ctx1")) to backend
    }

    @Test
    fun `views go through query and writes through execute`() =
        runTest {
            val (dispatcher, backend) = dispatcher()
            assertEquals("""[{"k":"4,5","t":3}]""", dispatcher.run(BridgeOp.QUERY, "get_overrides", "{}"))
            assertEquals("1", dispatcher.run(BridgeOp.EXECUTE, "set_tiles", """{"edits":[{"x":4,"y":5,"t":0}],"now":99}"""))
            assertEquals(
                "null",
                dispatcher.run(
                    BridgeOp.EXECUTE,
                    "heartbeat",
                    """{"t":{"name":"Ada","x":1.25,"y":2,"dir":-1,"sel":2,"action":"walking"},"now":100}""",
                ),
            )
            val calls = backend.recording.calls
            assertEquals(listOf("get_overrides", "set_tiles", "heartbeat"), calls.map { it.method })
            assertEquals(
                listOf(RecordedContractCall.Path.QUERY, RecordedContractCall.Path.EXECUTE, RecordedContractCall.Path.EXECUTE),
                calls.map { it.path },
            )
            assertEquals(listOf("ctx1", "ctx1", "ctx1"), calls.map { it.contextId })
            val edits = (calls[1].args as JsonObject)["edits"] as JsonArray
            assertEquals(Json.parseToJsonElement("""[{"x":4,"y":5,"t":0}]"""), edits)
            assertEquals(JsonPrimitive("walking"), ((calls[2].args as JsonObject)["t"] as JsonObject)["action"])
        }

    @Test
    fun `join returns the player view`() =
        runTest {
            val (dispatcher, _) = dispatcher()
            val joined = dispatcher.run(BridgeOp.EXECUTE, "join", """{"name":"Ada","now":5}""")
            assertEquals("dev1", Json.decodeFromString(PlayerView.serializer(), joined).id)
        }

    @Test
    fun `refuses wrong kind unknown methods init and bad args`() =
        runTest {
            val (dispatcher, backend) = dispatcher()
            listOf(
                Triple(BridgeOp.EXECUTE, "get_overrides", "{}"),
                Triple(BridgeOp.QUERY, "set_tiles", """{"edits":[],"now":1}"""),
                Triple(BridgeOp.EXECUTE, "init", """{"name":"x","seed":1,"now":1}"""),
                Triple(BridgeOp.QUERY, "drop_tables", "{}"),
                Triple(BridgeOp.EXECUTE, "set_tiles", """{"edits":"nope","now":1}"""),
            ).forEach { (op, method, args) ->
                try {
                    dispatcher.run(op, method, args)
                    fail("$method via $op should have been refused")
                } catch (e: BridgeFailure) {
                    assertTrue(e.message.orEmpty().isNotEmpty())
                }
            }
            assertTrue(backend.recording.calls.isEmpty())
        }
}
