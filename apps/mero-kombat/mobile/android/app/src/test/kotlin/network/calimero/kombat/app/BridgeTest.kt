package network.calimero.kombat.app

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The wire form both sides of the bridge agree on (`web/src/protocol.ts`). The iOS `BridgeTests` pin the same strings. */
class BridgeTest {
    @Test
    fun `decodes every page message`() {
        assertEquals(BridgeInbound.Ready, BridgeInbound.decode("""{"v":1,"op":"ready"}"""))
        assertEquals(
            BridgeInbound.Call(7, BridgeInbound.CallKind.EXECUTE, "act", """{"kind":"punch","round":1}"""),
            BridgeInbound.decode("""{"v":1,"op":"execute","id":7,"method":"act","args":{"round":1,"kind":"punch"}}"""),
        )
        assertEquals(
            BridgeInbound.Call(8, BridgeInbound.CallKind.QUERY, "arena", "{}"),
            BridgeInbound.decode("""{"v":1,"op":"query","id":8,"method":"arena"}"""),
        )
        assertEquals(
            BridgeInbound.Presence("""{"seat":"p2","v":1,"x":150}"""),
            BridgeInbound.decode("""{"v":1,"op":"presence","slice":{"v":1,"seat":"p2","x":150}}"""),
        )
        assertEquals(BridgeInbound.Over(true), BridgeInbound.decode("""{"v":1,"op":"over","over":true}"""))
    }

    @Test
    fun `refuses what is not a message`() {
        assertNull(BridgeInbound.decode("not json"))
        assertNull("no version", BridgeInbound.decode("""{"op":"ready"}"""))
        assertNull("a version this app does not speak", BridgeInbound.decode("""{"v":2,"op":"ready"}"""))
        assertNull("a call without an id", BridgeInbound.decode("""{"v":1,"op":"execute","method":"act"}"""))
        assertNull(BridgeInbound.decode("""{"v":1,"op":"query","id":1,"method":""}"""))
        assertNull(BridgeInbound.decode("""{"v":1,"op":"presence","slice":3}"""))
        assertNull(BridgeInbound.decode("""{"v":1,"op":"teleport"}"""))
    }

    @Test
    fun `encodes every native message`() {
        assertEquals(
            """{"t":"boot","mode":"net","local":1,"fighters":["kinetic","cryo"],"muted":false}""",
            BridgeOutbound.Boot(GameMode.NET, 1, listOf("kinetic", "cryo"), false).json,
        )
        assertEquals(
            """{"t":"boot","mode":"spectate","local":null,"fighters":["jinzo","cryo"],"muted":true}""",
            BridgeOutbound.Boot(GameMode.SPECTATE, null, listOf("jinzo", "cryo"), true).json,
        )
        assertEquals("""{"t":"state","view":{"round":1}}""", BridgeOutbound.State("""{"round":1}""").json)
        assertEquals("""{"t":"slice","slice":{"seat":"p2"}}""", BridgeOutbound.Slice("""{"seat":"p2"}""").json)
        assertEquals("""{"t":"press","b":"punch","d":true}""", BridgeOutbound.Press(PadButton.PUNCH, true).json)
        assertEquals("""{"t":"press","b":"left","d":false}""", BridgeOutbound.Press(PadButton.LEFT, false).json)
        assertEquals("""{"t":"result","id":3,"ok":true,"value":null}""", BridgeOutbound.Result(3, "null").json)
        assertEquals(
            """{"t":"result","id":4,"ok":false,"error":"round \"2\" is over"}""",
            BridgeOutbound.Failure(4, """round "2" is over""").json,
        )
        assertEquals("""{"t":"pause"}""", BridgeOutbound.Pause.json)
        assertEquals("""{"t":"resume"}""", BridgeOutbound.Resume.json)
        assertEquals("""{"t":"restart"}""", BridgeOutbound.Restart.json)
        assertEquals("""{"t":"mute","on":true}""", BridgeOutbound.Mute(true).json)
    }

    @Test
    fun `every message is valid JSON and a guarded call`() {
        val all =
            listOf(
                BridgeOutbound.Boot(GameMode.CPU, 0, listOf("kinetic", "cryo"), false),
                BridgeOutbound.State("{}"),
                BridgeOutbound.Slice("{}"),
                BridgeOutbound.Press(PadButton.SPECIAL, true),
                BridgeOutbound.Result(1, "[1,2]"),
                BridgeOutbound.Failure(2, "line\nbreak"),
                BridgeOutbound.Pause,
                BridgeOutbound.Resume,
                BridgeOutbound.Restart,
                BridgeOutbound.Mute(false),
            )
        all.forEach { message ->
            Json.parseToJsonElement(message.json)
            assertEquals("window.meroGame&&window.meroGame.receive(${message.json});", message.script)
        }
    }
}
