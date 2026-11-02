package network.calimero.kombat.app

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import network.calimero.kombat.contract.ArenaView
import network.calimero.kombat.contract.KombatClient
import network.calimero.kombat.contract.MatchSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * The hand-typed client against the contract's component ABI: method names, camelCase fields and u64
 * values as decimal strings. (Swift `ContractTests`.)
 */
class ContractTest {
    @Test
    fun `the method lists are the ABI's`() {
        // The app module's directory is the working directory of a unit test.
        val abi = Json.parseToJsonElement(File("../../../logic/res/abi.json").readText()).jsonObject
        // Until the component port (apps#711) is on this branch the ABI is the v1 one: nothing to compare.
        assumeTrue("logic/res/abi.json is not a component ABI yet", abi["world"] != null)
        val methods = abi["methods"]!!.jsonObject

        fun of(kind: String) = methods.filter { (it.value.jsonObject["kind"] as? JsonPrimitive)?.content == kind }.keys.sorted()
        assertEquals(KombatClient.CALLS, of("call"))
        assertEquals(KombatClient.VIEWS, of("view"))
    }

    @Test
    fun `the arena reads the component wire`() {
        val wire =
            """
            {"title":"Arena","createdAt":"1700000000000","matchIndex":2,"round":1,"status":"fighting",
             "roundResults":["p1"],"winner":"","flawless":false,
             "p1":{"seat":"p1","member":"acc_a","name":"Ana","fighter":"cryo","hp":80,"roundsWon":1,"matchesWon":0,"online":true},
             "p2":{"seat":"p2","member":"acc_b","name":"","fighter":"jinzo","hp":100,"roundsWon":0,"matchesWon":3,"online":false},
             "me":"acc_a","mySeat":"p1","hits":[{"by":"p1","id":7,"kind":"punch","damage":5,"blocked":false,"at":"1700000000123"}],
             "matchActions":4,"totalActions":"18446744073709551615","maxHp":100,"roundsToWin":2}
            """.trimIndent()
        val view = KombatClient.JSON.decodeFromString(ArenaView.serializer(), wire)
        assertEquals(2u, view.matchIndex)
        assertEquals("p1", view.mySeat)
        assertEquals(3u, view.p2.matchesWon)
        assertEquals(1_700_000_000_000uL, view.createdAt)
        assertEquals("a u64 keeps every digit", ULong.MAX_VALUE, view.totalActions)
        assertEquals(1_700_000_000_123uL, view.hits.first().at)
        val back = Json.parseToJsonElement(KombatClient.JSON.encodeToString(ArenaView.serializer(), view)).jsonObject
        assertEquals(JsonPrimitive("18446744073709551615"), back["totalActions"])
        assertEquals(JsonPrimitive("p1"), back["mySeat"])
    }

    @Test
    fun `the history reads the component wire`() {
        val wire = """[{"index":0,"startedAt":"5","winner":"p2","flawless":true,"rounds":["p2","p2"],"actions":12}]"""
        val past = KombatClient.JSON.decodeFromString(ListSerializer(MatchSummary.serializer()), wire)
        assertEquals(listOf(MatchSummary(0u, 5uL, "p2", true, listOf("p2", "p2"), 12u)), past)
    }

    @Test
    fun `the page still reads snake_case`() {
        val page = Json.parseToJsonElement(GameCalls.encode(Fixtures.arena())).jsonObject
        assertEquals("p1", page["my_seat"]?.jsonPrimitive?.content)
        assertEquals("0", page["match_index"]?.jsonPrimitive?.content)
        assertEquals(
            "0",
            page["p1"]
                ?.jsonObject
                ?.get("rounds_won")
                ?.jsonPrimitive
                ?.content,
        )
        assertNull(page["mySeat"])
    }

    @Test
    fun `init args carry now as a decimal string`() {
        assertEquals(
            JsonObject(mapOf("title" to JsonPrimitive("Friday"), "now" to JsonPrimitive("42"))),
            KombatClient.initArgs("Friday", 42uL),
        )
    }
}
