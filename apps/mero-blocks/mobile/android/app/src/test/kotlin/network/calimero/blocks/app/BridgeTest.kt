package network.calimero.blocks.app

import com.calimero.mero.testkit.RecordedContractCall
import com.calimero.mero.testkit.RecordingContextContract
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import network.calimero.blocks.generated.BlocksClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

private fun obj(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

/** The page ↔ app message format. The page half is `game/src/bridge.ts`; Swift `BridgeCodecTests` pins the same shapes. */
class BridgeCodecTest {
    @Test
    fun decodesACallWithItsArgumentsIntact() {
        val text =
            """{"id":7,"op":"execute","method":"heartbeat","args":{"t":{"name":"Ana","x":12.5,"y":30,"z":-4.25,"yaw":1.571,"pitch":-0.2,"sel":3},"now":1730000000}}"""
        val call = BridgeCodec.decode(text) as BridgeRequest.Call
        assertEquals(7, call.id)
        assertEquals(BridgeOp.EXECUTE, call.op)
        assertEquals("heartbeat", call.method)
        val args = obj(call.argsJson)
        assertEquals(1_730_000_000L, args["now"]!!.jsonPrimitive.long)
        val t = args["t"]!!.jsonObject
        assertEquals(12.5, t["x"]!!.jsonPrimitive.double, 0.0)
        assertEquals(-4.25, t["z"]!!.jsonPrimitive.double, 0.0)
        assertEquals("Ana", t["name"]!!.jsonPrimitive.content)
        assertTrue("an integer stays an integer", call.argsJson.contains("\"now\":1730000000"))
    }

    @Test
    fun aMissingArgsObjectIsEmpty() {
        val call = BridgeCodec.decode("""{"id":1,"op":"query","method":"world_meta"}""") as BridgeRequest.Call
        assertEquals(BridgeOp.QUERY, call.op)
        assertEquals("world_meta", call.method)
        assertEquals("{}", call.argsJson)
    }

    @Test
    fun decodesThePagesOneWayMessages() {
        assertEquals(BridgeRequest.Ready, BridgeCodec.decode("""{"op":"ready"}"""))
        assertEquals(BridgeRequest.Loaded, BridgeCodec.decode("""{"op":"loaded"}"""))
        assertEquals(BridgeRequest.Menu, BridgeCodec.decode("""{"op":"menu"}"""))
        assertEquals(BridgeRequest.Haptic("selection"), BridgeCodec.decode("""{"op":"haptic","style":"selection"}"""))
        assertEquals(BridgeRequest.Fatal("gone"), BridgeCodec.decode("""{"op":"fatal","message":"gone"}"""))
    }

    @Test
    fun refusesWhatIsNotAMessage() {
        val junk =
            listOf(
                "",
                "[]",
                "not json",
                """{"id":1}""",
                """{"op":"teleport"}""",
                """{"op":"query","method":"get_players"}""",
                """{"id":1,"op":"query"}""",
                """{"id":1,"op":"query","method":"world_meta","args":[1,2]}""",
            )
        for (text in junk) {
            try {
                BridgeCodec.decode(text)
                fail("decoded $text")
            } catch (_: BridgeException) {
            }
        }
    }

    @Test
    fun encodesAResultAroundTheContractsJson() {
        val message = obj(BridgeCodec.result(3, """[{"k":"1,2,3","b":4}]"""))
        assertEquals("result", message["type"]!!.jsonPrimitive.content)
        assertEquals(3, message["id"]!!.jsonPrimitive.int)
        assertTrue(message["ok"]!!.jsonPrimitive.boolean)
        assertEquals(
            "1,2,3",
            message["result"]!!
                .jsonArray[0]
                .jsonObject["k"]!!
                .jsonPrimitive.content,
        )
        assertEquals("""{"type":"result","id":4,"ok":true,"result":null}""", BridgeCodec.result(4, ""))
    }

    @Test
    fun encodesAFailure() {
        val message = obj(BridgeCodec.failure(9, """refused: "no" \ really"""))
        assertFalse(message["ok"]!!.jsonPrimitive.boolean)
        assertEquals(9, message["id"]!!.jsonPrimitive.int)
        assertEquals("""refused: "no" \ really""", message["error"]!!.jsonPrimitive.content)
    }

    @Test
    fun encodesStartWithInsets() {
        val start = GameStart("ctx", "me", "Ana", "Lime Valley", 1.5)
        val message = obj(BridgeCodec.start(start, GameInsets(0.0, 47.0, 21.0, 47.0)))
        assertEquals("start", message["type"]!!.jsonPrimitive.content)
        assertEquals("ctx", message["contextId"]!!.jsonPrimitive.content)
        assertEquals("me", message["myId"]!!.jsonPrimitive.content)
        assertEquals("Ana", message["name"]!!.jsonPrimitive.content)
        assertEquals("Lime Valley", message["worldName"]!!.jsonPrimitive.content)
        assertEquals(1.5, message["sensitivity"]!!.jsonPrimitive.double, 0.0)
        assertEquals(47.0, message["insets"]!!.jsonObject["left"]!!.jsonPrimitive.double, 0.0)
    }

    @Test
    fun encodesTheAppsOneWayMessages() {
        assertEquals("""{"type":"pause"}""", BridgeCodec.PAUSE)
        assertEquals("""{"type":"resume"}""", BridgeCodec.RESUME)
        assertEquals("""{"kind":"StateMutation","type":"event"}""", BridgeCodec.event("StateMutation"))
        assertEquals("settings", obj(BridgeCodec.settings(2.0))["type"]!!.jsonPrimitive.content)
        assertEquals("insets", obj(BridgeCodec.insets(GameInsets.ZERO))["type"]!!.jsonPrimitive.content)
    }

    /** The script carries the message as a JS string literal: quotes, backslashes, a closing script tag and line breaks never break out into code. */
    @Test
    fun theScriptPassesTheMessageAsAStringLiteral() {
        val message = BridgeCodec.failure(1, "a \"quote\", a \\ backslash, </script>, a\nnewline and  ")
        val script = BridgeCodec.script(message)
        val prefix = "window.meroBridge&&window.meroBridge.receive("
        assertTrue(script.startsWith(prefix))
        assertTrue(script.endsWith(");"))
        val literal = script.removePrefix(prefix).removeSuffix(");")
        assertTrue(literal.startsWith("\"") && literal.endsWith("\""))
        assertFalse("a raw newline would end the statement", literal.contains("\n"))
        assertEquals(message, Json.parseToJsonElement(literal).jsonPrimitive.content)
    }
}

/** Contract calls from the page go through the generated client on the right path, with typed arguments; nothing else gets through. */
class BridgeRouterTest {
    private val contextId = "cc".repeat(32)
    private val recording =
        RecordingContextContract { call ->
            when (call.method) {
                "worldMeta" ->
                    buildJsonObject {
                        put("name", "Lime Valley")
                        put("seed", "1337")
                        put("createdAt", "1730000000")
                    }
                // Two pages: the router follows `next`.
                "getOverrides" ->
                    // The generated client sends an unset `option` argument as `null`, which the
                    // contract reads as none, as it does a missing key.
                    if (call.args.jsonObject["cursor"].let { it == null || it is JsonNull }) {
                        page(entry("1,2,3", 8), next = "p2")
                    } else {
                        page(entry("4,5,6", 2), next = null)
                    }
                "getPlayers" -> page(player("ab".repeat(32), "Ana"), next = null)
                "join" -> player("me", "Ana")
                "setBlocks" -> JsonPrimitive(2)
                else -> JsonNull
            }
        }

    private fun entry(
        k: String,
        b: Int,
    ) = buildJsonObject {
        put("k", k)
        put("b", b)
    }

    private fun page(
        item: JsonObject,
        next: String?,
    ) = buildJsonObject {
        put("items", buildJsonArray { add(item) })
        put("next", next?.let(::JsonPrimitive) ?: JsonNull)
    }

    private val router = BridgeRouter(BlocksClient(recording.bound(contextId)))

    private fun player(
        id: String,
        name: String,
    ) = buildJsonObject {
        put("id", id)
        put("account", id)
        put("device", "")
        put("name", name)
        put("x", 1.5)
        put("y", 30)
        put("z", 2)
        put("yaw", 0.5)
        put("pitch", 0)
        put("sel", 2)
        put("online", true)
    }

    @Test
    fun viewsAreQueries() =
        runTest {
            val meta = obj(router.handle(BridgeOp.QUERY, "world_meta", "{}"))
            assertEquals(1337, meta["seed"]!!.jsonPrimitive.int)
            assertEquals(1_730_000_000L, meta["createdAt"]!!.jsonPrimitive.long)
            assertEquals(RecordedContractCall.Path.QUERY, recording.calls("worldMeta").first().path)
            assertEquals(contextId, recording.calls("worldMeta").first().contextId)

            val players = Json.parseToJsonElement(router.handle(BridgeOp.QUERY, "get_players", """{"now":1730000001}""")).jsonArray
            assertEquals("Ana", players[0].jsonObject["name"]!!.jsonPrimitive.content)
            // u64 on the component wire is a decimal string.
            assertEquals(
                JsonPrimitive("1730000001"),
                recording
                    .calls("getPlayers")
                    .first()
                    .args.jsonObject["now"],
            )

            // Both pages, as one list: the page's shape.
            val overrides = Json.parseToJsonElement(router.handle(BridgeOp.QUERY, "get_overrides", "{}")).jsonArray
            assertEquals(listOf(8, 2), overrides.map { it.jsonObject["b"]!!.jsonPrimitive.int })
            assertEquals(listOf(JsonNull, JsonPrimitive("p2")), recording.calls("getOverrides").map { it.args.jsonObject["cursor"] })

            // A page built against the component ABI may use its names.
            router.handle(BridgeOp.QUERY, "worldMeta", "{}")
            assertEquals(2, recording.calls("worldMeta").size)
        }

    @Test
    fun mutationsAreSignedExecutes() =
        runTest {
            val heartbeat = """{"t":{"name":"Ana","x":12.5,"y":30,"z":-4.25,"yaw":1.571,"pitch":-0.2,"sel":3},"now":1730000000}"""
            assertEquals("null", router.handle(BridgeOp.EXECUTE, "heartbeat", heartbeat))
            val call = recording.calls("heartbeat").first()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            val t = call.args.jsonObject["t"]!!.jsonObject
            assertEquals(12.5, t["x"]!!.jsonPrimitive.double, 0.0)
            assertEquals(3, t["sel"]!!.jsonPrimitive.int)
            assertEquals(JsonPrimitive("1730000000"), call.args.jsonObject["now"])

            val edits = """{"edits":[{"x":10,"y":31,"z":12,"b":0},{"x":10,"y":32,"z":12,"b":8}],"now":1730000002}"""
            assertEquals("2", router.handle(BridgeOp.EXECUTE, "set_blocks", edits))
            assertEquals(
                2,
                recording
                    .calls("setBlocks")
                    .first()
                    .args.jsonObject["edits"]!!
                    .jsonArray.size,
            )

            assertEquals("me", obj(router.handle(BridgeOp.EXECUTE, "join", """{"name":"Ana","now":1}"""))["id"]!!.jsonPrimitive.content)
            router.handle(BridgeOp.EXECUTE, "leave", """{"now":2}""")
            assertEquals(List(4) { RecordedContractCall.Path.EXECUTE }, recording.calls.map { it.path })
        }

    @Test
    fun refusesMethodsTheGameDoesNotUse() =
        runTest {
            for (method in listOf("init", "drop_world", "")) {
                try {
                    router.handle(BridgeOp.EXECUTE, method, "{}")
                    fail("$method got through")
                } catch (e: BridgeException) {
                    assertEquals("The game may not call $method.", e.message)
                }
            }
            assertTrue(recording.calls.isEmpty())
        }

    @Test
    fun refusesTheWrongPath() =
        runTest {
            try {
                router.handle(BridgeOp.QUERY, "set_blocks", """{"edits":[],"now":1}""")
                fail("a mutation went through query")
            } catch (e: BridgeException) {
                assertEquals("set_blocks must go through execute.", e.message)
            }
            try {
                router.handle(BridgeOp.EXECUTE, "get_players", """{"now":1}""")
                fail("a view went through execute")
            } catch (e: BridgeException) {
                assertEquals("get_players must go through query.", e.message)
            }
            assertTrue(recording.calls.isEmpty())
        }

    @Test
    fun refusesArgumentsOfTheWrongShape() =
        runTest {
            val cases =
                listOf(
                    "get_players" to "{}",
                    "set_blocks" to """{"edits":[{"x":"a"}],"now":1}""",
                    "join" to """{"now":1}""",
                    "set_blocks" to """{"edits":[{"x":1,"y":2,"z":3,"b":-1}],"now":1}""",
                    "set_blocks" to """{"edits":[{"x":1,"y":2,"z":3,"b":16}],"now":1}""",
                )
            for ((method, args) in cases) {
                val op = if (BridgeRouter.contractMethod(method) in BridgeRouter.VIEWS) BridgeOp.QUERY else BridgeOp.EXECUTE
                try {
                    router.handle(op, method, args)
                    fail("$method $args got through")
                } catch (e: BridgeException) {
                    assertTrue(e.message!!, e.message!!.startsWith("Bad arguments for $method"))
                }
            }
            assertTrue(recording.calls.isEmpty())
        }
}
