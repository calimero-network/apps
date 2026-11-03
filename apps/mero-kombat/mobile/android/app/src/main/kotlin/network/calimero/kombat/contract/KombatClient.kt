package network.calimero.kombat.contract

import com.calimero.mero.app.ContextContractCalling
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// The arena contract's component ABI (`logic/res/abi.json`, `calimero:app@0.5.0`), typed by hand:
// no Kotlin client is generated from a component ABI yet. It mirrors the web app's
// `app/src/kombat.ts`, and `ContractTest` checks the method lists against the committed ABI.
// (Swift `KombatClient`.)
//
// Wire format (component ABI):
// - argument and result fields are camelCase (`matchIndex`, `mySeat`, `roundsWon`, …);
// - every `u64` travels as a decimal string (`now`, `createdAt`, `totalActions`, `hits[].at`,
//   `startedAt`); the Kotlin fields stay `ULong` and are converted by [U64];
// - a refusal is `422 APP_ERROR {code, fields}`, an `AppError` (see [KombatRefusal]).

/** Typed calls to the arena. Views go through `query` (`POST /apps/{app}/views`), calls through `execute` (an intent). */
class KombatClient(
    private val transport: ContextContractCalling,
) {
    /** Record one blow in round [round] of match [matchIndex]. */
    @Suppress("LongParameterList")
    suspend fun act(
        matchIndex: UInt,
        round: UInt,
        id: UInt,
        kind: String,
        hit: Boolean,
        blocked: Boolean,
        now: ULong,
    ) {
        transport.execute("act", JSON.encodeToString(ActArgs.serializer(), ActArgs(matchIndex, round, id, kind, hit, blocked, now)))
    }

    /** The whole arena in one read. */
    suspend fun arena(now: ULong): ArenaView =
        JSON.decodeFromString(ArenaView.serializer(), transport.query("arena", JSON.encodeToString(NowArgs.serializer(), NowArgs(now))))

    /** Every match this arena has fought, oldest first. */
    suspend fun history(): List<MatchSummary> =
        JSON.decodeFromString(ListSerializer(MatchSummary.serializer()), transport.query("history", "{}"))

    /** Announce yourself, or refresh your name and fighter. */
    suspend fun join(
        name: String,
        fighter: String,
        now: ULong,
    ) {
        transport.execute("join", JSON.encodeToString(JoinArgs.serializer(), JoinArgs(name, fighter, now)))
    }

    /** Change fighter. */
    suspend fun pick(
        fighter: String,
        now: ULong,
    ) {
        transport.execute("pick", JSON.encodeToString(PickArgs.serializer(), PickArgs(fighter, now)))
    }

    /** Start the next match; answers its index. */
    suspend fun rematch(now: ULong): UInt =
        JSON.decodeFromString(UInt.serializer(), transport.execute("rematch", JSON.encodeToString(NowArgs.serializer(), NowArgs(now))))

    /** Take corner `p1` or `p2`, if it is free. */
    suspend fun sit(
        seat: String,
        name: String,
        fighter: String,
        now: ULong,
    ) {
        transport.execute("sit", JSON.encodeToString(SitArgs.serializer(), SitArgs(seat, name, fighter, now)))
    }

    /** Leave your corner (only before you have fought here). */
    suspend fun stand(now: ULong) {
        transport.execute("stand", JSON.encodeToString(NowArgs.serializer(), NowArgs(now)))
    }

    @Serializable
    private data class NowArgs(
        @Serializable(with = U64::class) val now: ULong,
    )

    @Serializable
    private data class JoinArgs(
        val name: String,
        val fighter: String,
        @Serializable(with = U64::class) val now: ULong,
    )

    @Serializable
    private data class PickArgs(
        val fighter: String,
        @Serializable(with = U64::class) val now: ULong,
    )

    @Serializable
    private data class SitArgs(
        val seat: String,
        val name: String,
        val fighter: String,
        @Serializable(with = U64::class) val now: ULong,
    )

    @Serializable
    private data class ActArgs(
        val matchIndex: UInt,
        val round: UInt,
        val id: UInt,
        val kind: String,
        val hit: Boolean,
        val blocked: Boolean,
        @Serializable(with = U64::class) val now: ULong,
    )

    companion object {
        /** The contract's calls (writes), by their ABI names. */
        val CALLS = listOf("act", "join", "pick", "rematch", "sit", "stand")

        /** The contract's views (reads), by their ABI names. */
        val VIEWS = listOf("arena", "history")

        /** The JSON the contract speaks. */
        val JSON = Json { ignoreUnknownKeys = true }

        /** The `init` arguments a new arena instance is created with (`init(title?, now?)`). */
        fun initArgs(
            title: String,
            now: ULong,
        ): JsonObject =
            buildJsonObject {
                put("title", title)
                put("now", now.toString())
            }
    }
}

/** A `u64` on the wire: a decimal string. Reads a bare number too (an older node, a fixture). */
object U64 : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("u64", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: ULong,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): ULong {
        val text =
            if (decoder is JsonDecoder) {
                (decoder.decodeJsonElement() as? JsonPrimitive)?.content
            } else {
                decoder.decodeString()
            }
        return text?.toULongOrNull() ?: throw SerializationException("not a u64: $text")
    }
}

/** Everything the arena draws, in one read (the contract's `ArenaView`). */
@Serializable
data class ArenaView(
    val title: String,
    @Serializable(with = U64::class) val createdAt: ULong,
    /** The match being fought now. */
    val matchIndex: UInt,
    /** The round being fought now (0-based). */
    val round: UInt,
    /** `waiting`, `fighting` or `finished`. */
    val status: String,
    /** One entry per decided round of this match: `p1` or `p2`. */
    val roundResults: List<String>,
    /** `p1`, `p2`, or `""` while the match is on. */
    val winner: String,
    val flawless: Boolean,
    val p1: FighterView,
    val p2: FighterView,
    /** The caller's account id. */
    val me: String,
    /** `p1`, `p2`, or `""` for a spectator. */
    val mySeat: String,
    /** This round's landed blows, in log order. */
    val hits: List<HitView>,
    /** Actions written in the current match, both corners. */
    val matchActions: UInt,
    /** Every action ever written at this arena: the transaction count. */
    @Serializable(with = U64::class) val totalActions: ULong,
    val maxHp: UInt,
    val roundsToWin: UInt,
)

/** One corner (the contract's `FighterView`). */
@Serializable
data class FighterView(
    /** `p1` or `p2`. */
    val seat: String,
    /** The account in this corner, or `""` when it is empty. */
    val member: String,
    val name: String,
    val fighter: String,
    /** Health left in the current round. */
    val hp: UInt,
    val roundsWon: UInt,
    /** Matches this corner has won at this arena. */
    val matchesWon: UInt,
    val online: Boolean,
)

/** One blow of the current round (the contract's `HitView`). */
@Serializable
data class HitView(
    /** The corner that threw it. */
    val by: String,
    /** The thrower's own sequence number. */
    val id: UInt,
    val kind: String,
    val damage: UInt,
    val blocked: Boolean,
    @Serializable(with = U64::class) val at: ULong,
)

/** One match of the arena's record (the contract's `MatchSummary`). */
@Serializable
data class MatchSummary(
    val index: UInt,
    @Serializable(with = U64::class) val startedAt: ULong,
    val winner: String,
    val flawless: Boolean,
    val rounds: List<String>,
    val actions: UInt,
)

/** The contract's refusals (`#[app::error]`), in the words the web app shows (`kombat.ts` `MESSAGES`). (Swift `KombatRefusal`.) */
object KombatRefusal {
    val MESSAGES: Map<String, String> =
        mapOf(
            "UnknownSeat" to "A corner is either p1 or p2.",
            "UnknownFighter" to "Unknown fighter.",
            "UnknownMove" to "Unknown move.",
            "CornerTaken" to "That corner is taken.",
            "InOtherCorner" to "You are already in the other corner.",
            "NotInCorner" to "Only a fighter in a corner can do that.",
            "AlreadyFought" to "You have already fought here.",
            "WaitingForOpponent" to "Waiting for an opponent.",
            "MatchOver" to "This match is over.",
            "WrongMatch" to "That match is not being fought.",
            "RoundOver" to "That round is over.",
            "ActionLimit" to "This round has reached its action limit.",
            "MatchNotFinished" to "Finish this match first.",
            "MatchLimit" to "This arena has fought all the matches it counts.",
        )

    /** The sentence for an `APP_ERROR` code, or null for a code the contract does not declare. */
    fun message(code: String): String? = MESSAGES[code]
}
