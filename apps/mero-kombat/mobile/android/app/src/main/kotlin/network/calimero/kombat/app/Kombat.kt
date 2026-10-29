package network.calimero.kombat.app

import com.calimero.mero.app.MeroAppBackend
import network.calimero.kombat.generated.ArenaView
import network.calimero.kombat.generated.FighterView
import network.calimero.kombat.generated.KombatClient

/** The app's fixed values, shared with the web app and the contract's bundle. (Swift `KombatConstants`.) */
object KombatConstants {
    /** The bundle's package id (`logic/Cargo.toml`), which is also the invitation link slug. */
    const val PACKAGE_NAME = "com.calimero.mero-kombat"

    /** What a new arena is called when the field is left empty (the web app's only title). */
    const val DEFAULT_TITLE = "Arena"

    /** What a fighter is called when they gave no name (the web app's placeholder). */
    const val DEFAULT_NAME = "Fighter"

    /** The web app's fallback poll: events are the fast path. */
    const val POLL_MILLIS = 3_000L

    /** The web app's floor between two contract reads when events arrive in a burst. */
    const val MIN_READ_GAP_MILLIS = 160L

    /** A corner whose presence stopped this long ago is "away" (the web app's 4 s). */
    const val PRESENCE_STALE_MILLIS = 4_000L
}

/** Milliseconds since the epoch: every `now` the contract takes. */
fun nowMillis(): ULong = System.currentTimeMillis().toULong()

/**
 * [KombatClient] for [contextId] in the account's backend: the SDK's bound contract is the generated
 * client's transport as is (`--transport-import com.calimero.mero.app.ContextContractCalling`).
 */
fun kombatClient(
    backend: MeroAppBackend,
    contextId: String,
): KombatClient = KombatClient(backend.contract.bound(contextId))

/**
 * One of the four fighters. Must match `FIGHTERS` in logic/src/lib.rs and `app/src/game/fighters.ts`:
 * the contract refuses any other id. (Swift `FighterInfo`.)
 */
data class FighterInfo(
    val id: String,
    val name: String,
    val title: String,
    val special: String,
    /** The costume's main colour, 0xRRGGBB. */
    val color: Long,
) {
    companion object {
        val roster =
            listOf(
                FighterInfo("kinetic", "KINETIC", "Keeper of the Ledger", "Mero Bolt", 0x8FDC0A),
                FighterInfo("cryo", "CRYO", "Frost of the North Node", "Ice Shard", 0x2F7DF0),
                FighterInfo("inferno", "INFERNO", "Spectre of the Burned Fork", "Hellfire", 0xF2B01E),
                FighterInfo("jinzo", "JINZO", "Monk of the Open Gossip", "Dragon Flame", 0xD42A2A),
            )

        /** The web app's `fighterOf`: an unknown id is Kinetic. */
        fun of(id: String): FighterInfo = roster.firstOrNull { it.id == id } ?: roster[0]

        /** The CPU in practice: the first fighter that is not yours (the web app's choice). */
        fun cpu(against: String): FighterInfo = roster.firstOrNull { it.id != against } ?: roster[1]
    }
}

/** Where the player's name and fighter live between visits, under the web app's keys. (Swift `PlayerStore`.) */
interface PlayerStore {
    var name: String
    var fighter: String
    var muted: Boolean
}

/** For tests and previews. */
class MemoryPlayerStore(
    override var name: String = "",
    override var fighter: String = "kinetic",
    override var muted: Boolean = false,
) : PlayerStore

/** Thrown by the models with a sentence for the player. (Swift `KombatError`.) */
class KombatException(
    val kind: Kind,
) : Exception(kind.message) {
    enum class Kind(
        val message: String,
    ) {
        NO_NAMESPACE("This arena's namespace is not known on this device yet. Open it from Arenas and try again."),
        NO_APPLICATION("Mero Kombat is still being looked up in the app registry. Try again in a moment."),
        NOT_AN_INVITATION("That is not a Mero Kombat invitation link."),
        NO_RELAY("Your account has no relay yet. Join an arena from an invitation link first."),
    }
}

/** Every sentence worked out from the contract's answers. Same words as the web app. (Swift `KombatText`.) */
object KombatText {
    /** The status pill: the web app's `StatusPill`. */
    fun status(
        view: ArenaView,
        bothLive: Boolean,
    ): String =
        when (view.status) {
            "waiting" -> "Waiting for fighters"
            "finished" -> "Match over"
            else -> if (bothLive) "Round ${view.round + 1u} · live" else "Round ${view.round + 1u}"
        }

    /** "Ana wins", "Draw", for a match the contract decided. */
    fun winner(
        winner: String,
        view: ArenaView,
    ): String =
        when (winner) {
            "p1" -> "${name(view.p1)} wins"
            "p2" -> "${name(view.p2)} wins"
            "draw" -> "Draw"
            else -> ""
        }

    /** A corner's name: the one given, else "Corner 1" / "Corner 2". */
    fun name(fighter: FighterView): String =
        fighter.name.takeIf { it.isNotBlank() } ?: if (fighter.seat == "p1") "Corner 1" else "Corner 2"

    /** "Ana vs Open corner". */
    fun players(view: ArenaView): String {
        val one = if (view.p1.member.isEmpty()) "Open corner" else name(view.p1)
        val two = if (view.p2.member.isEmpty()) "Open corner" else name(view.p2)
        return "$one vs $two"
    }

    /** A readable short form of an id nobody named. */
    fun shortId(id: String): String = if (id.length > 12) "${id.take(6)}…${id.takeLast(4)}" else id

    /** An error as one sentence. A contract refusal is already written for a player, so it is shown as it came. */
    fun error(error: Throwable): String = error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong talking to the relay."
}
