package network.calimero.kombat.app

import com.calimero.mero.testkit.RecordingContextContract
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.kombat.generated.ArenaView
import network.calimero.kombat.generated.FighterView
import network.calimero.kombat.generated.HitView
import network.calimero.kombat.generated.MatchSummary

object Fixtures {
    val me = "ab".repeat(32)
    val them = "cd".repeat(32)

    fun corner(
        seat: String,
        member: String,
        name: String,
        fighter: String,
    ) = FighterView(seat = seat, member = member, name = name, fighter = fighter, hp = 100u, roundsWon = 0u, matchesWon = 0u, online = true)

    /** An arena where I hold the left corner and the fight is on. */
    fun arena(
        status: String = "fighting",
        mySeat: String = "p1",
        p1: FighterView = corner("p1", me, "Ana", "cryo"),
        p2: FighterView = corner("p2", them, "Ben", "jinzo"),
        matchActions: UInt = 3u,
    ) = ArenaView(
        title = "Friday night",
        createdAt = 1u,
        matchIndex = 0u,
        round = 1u,
        status = status,
        roundResults = listOf("p1"),
        winner = "",
        flawless = false,
        p1 = p1,
        p2 = p2,
        me = me,
        mySeat = mySeat,
        hits = listOf(HitView(by = "p1", id = 7u, kind = "punch", damage = 5u, blocked = false, at = 1u)),
        matchActions = matchActions,
        totalActions = 128u,
        maxHp = 100u,
        roundsToWin = 2u,
    )
}

/** A scriptable contract: answers `arena` with [view], `history` with [past], and refuses what it is told to. */
class ArenaScript(
    @Volatile var view: ArenaView,
) {
    @Volatile var past: List<MatchSummary> = emptyList()
    private val refusals = mutableMapOf<String, String>()

    fun refuse(
        method: String,
        message: String,
    ) {
        synchronized(refusals) { refusals[method] = message }
    }

    fun install(recording: RecordingContextContract) {
        recording.handler = { call ->
            synchronized(refusals) { refusals[call.method] }?.let { throw IllegalStateException(it) }
            when (call.method) {
                "arena" -> Json.encodeToJsonElement(ArenaView.serializer(), view)
                "history" -> Json.encodeToJsonElement(ListSerializer(MatchSummary.serializer()), past)
                "rematch" -> JsonPrimitive(1)
                else -> JsonNull as JsonElement
            }
        }
    }
}

/** Presence that records what is published and plays back what the test feeds it. */
class FakePresence(
    private val delayMillis: Long = 0,
) : PresenceChannel {
    val published = mutableListOf<String>()
    var retracted = 0
    val incoming = MutableSharedFlow<String>(extraBufferCapacity = 16)

    override suspend fun publish(sliceJson: String) {
        if (delayMillis > 0) delay(delayMillis)
        synchronized(published) { published += sliceJson }
    }

    override suspend fun retract() {
        retracted += 1
    }

    override fun slices(): Flow<String> = incoming
}

/** Collects what a model delivers to the page. */
class PageSpy {
    val messages = mutableListOf<BridgeOutbound>()

    fun attach(host: GameHost) {
        host.deliver = { messages += it }
    }

    val boots: List<BridgeOutbound.Boot> get() = messages.filterIsInstance<BridgeOutbound.Boot>()
    val states: List<String> get() = messages.filterIsInstance<BridgeOutbound.State>().map { it.viewJson }
}
