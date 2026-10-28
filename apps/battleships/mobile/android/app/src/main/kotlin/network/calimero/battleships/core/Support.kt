package network.calimero.battleships.core

import com.calimero.mero.account.NoRelayException
import com.calimero.mero.admin.AdminSurface
import com.calimero.mero.admin.CreateContextRequest
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.ContextContract
import com.calimero.mero.app.MeroAppBackend
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import network.calimero.battleships.generated.game.GameClient
import network.calimero.battleships.generated.lobby.LobbyClient
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import network.calimero.battleships.generated.game.ContextContractCalling as GameCalling
import network.calimero.battleships.generated.lobby.ContextContractCalling as LobbyCalling

/** Constants shared with the web app and the bundle. (Swift `Battleships`.) */
object Battleships {
    /** The registry package and invitation-link slug (`APP_SLUG` on the web). */
    const val PACKAGE_NAME = "com.calimero.battleships"

    /** The bundle's two services (`service_name` at context creation). */
    const val LOBBY_SERVICE = "lobby"
    const val GAME_SERVICE = "game"

    /**
     * How often an open match is re-read: the only refresh when the relay cannot stream, and a
     * safety net when it can (a dropped event must not stall a match). A lobby polls at twice this.
     */
    const val POLL_INTERVAL_MS = 5_000L
}

/** Why an action was refused before it reached the relay, in words a person can act on. */
class BattleshipsException(
    message: String,
) : Exception(message)

// ---- The backend ------------------------------------------------------------------------------

/**
 * What the screens need beyond [MeroAppBackend]: the bundle has two services, and the SDK's
 * `createContext` names none. The relay's admin does take a `serviceName` (as the web app's
 * `admin.createContext({ serviceName })`), so [AdminBattleshipsBackend] goes through it.
 * (Swift `BattleshipsBackend`.)
 */
interface BattleshipsBackend {
    val app: MeroAppBackend

    /** Create a context running [service] of the bundle in [groupId], with its `init` arguments. */
    suspend fun createServiceContext(
        groupId: String,
        applicationId: String,
        service: String,
        name: String,
        initArgs: JsonElement,
    ): String

    /** Which service a context runs (`Context.serviceName`), null when the relay does not say. */
    suspend fun serviceName(contextId: String): String?
}

/**
 * [BattleshipsBackend] over the session's backend and the account's admin
 * (`DelegatedAppBackend.admin`): a context is created as a delegated context intent carrying the
 * service name, and read back through the relay's caller-scoped `GET /contexts/{id}`.
 */
class AdminBattleshipsBackend(
    override val app: MeroAppBackend,
    private val admin: AdminSurface,
) : BattleshipsBackend {
    override suspend fun createServiceContext(
        groupId: String,
        applicationId: String,
        service: String,
        name: String,
        initArgs: JsonElement,
    ): String =
        admin
            .createContext(
                CreateContextRequest(
                    applicationId = applicationId,
                    groupId = groupId,
                    serviceName = service,
                    initializationParams = initArgs.toString().toByteArray(Charsets.UTF_8).map { it.toInt() and 0xff },
                    name = name,
                ),
            ).contextId

    override suspend fun serviceName(contextId: String): String? = admin.getContext(contextId).serviceName
}

// ---- Contract clients -------------------------------------------------------------------------

/** The SDK's bound contract as the lobby client's transport (the generated file declares its own interface). */
private class LobbyTransport(
    private val bound: com.calimero.mero.app.ContextContractCalling,
) : LobbyCalling {
    override suspend fun query(
        method: String,
        argsJson: String,
    ): String = bound.query(method, argsJson)

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String = bound.execute(method, argsJson)
}

/** As [LobbyTransport], for the game client. */
private class GameTransport(
    val bound: com.calimero.mero.app.ContextContractCalling,
) : GameCalling {
    override suspend fun query(
        method: String,
        argsJson: String,
    ): String = bound.query(method, argsJson)

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String = bound.execute(method, argsJson)
}

/** The lobby service's client in one context, over the account's relay. */
fun lobbyClient(
    contract: ContextContract,
    contextId: String,
): LobbyClient = LobbyClient(LobbyTransport(contract.bound(contextId)))

/**
 * The game service's client in one context, plus the two calls the generated client cannot make
 * as the contract needs them.
 */
class GameApi(
    contract: ContextContract,
    contextId: String,
) {
    private val bound = contract.bound(contextId)
    val client: GameClient = GameClient(GameTransport(bound))

    /**
     * `reveal_board`, with the salt as the JSON array of 16 numbers the contract's `[u8; 16]` reads
     * (what the web app's `CalimeroBytes` sends). The generated `revealBoard` types a fixed-size
     * `bytes` as a `String`, which the contract refuses, so this one call is written out; every
     * other call goes through the generated client.
     */
    suspend fun reveal(
        matchId: String,
        cells: List<Int>,
        salt: List<Int>,
    ) {
        val args =
            buildJsonObject {
                put("match_id", matchId)
                put("board_bytes", JsonArray(Commitment.boardBytes(cells).map { JsonPrimitive(it) }))
                put("salt", JsonArray(salt.map { JsonPrimitive(it) }))
            }
        bound.execute("reveal_board", args.toString())
    }

    /** `get_current_turn`, null once the match is over (the contract returns `None`). */
    suspend fun currentTurn(): String? =
        try {
            val raw = bound.query("get_current_turn", "{}")
            (Json.parseToJsonElement(raw) as? JsonPrimitive)?.contentOrNull
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
}

// ---- Errors in words --------------------------------------------------------------------------

/**
 * Errors as a person reads them: offline, no relay, or what the contract said, humanised as the
 * web app's `friendlyContractMessage`. (Swift `ErrorText`.)
 */
object ErrorText {
    private const val OFFLINE = "You're offline. Check your connection and try again."

    @Suppress("ReturnCount")
    fun describe(
        error: Throwable,
        fallback: String = "Something went wrong. Try again.",
    ): String {
        if (error is BattleshipsException) return error.message ?: fallback
        if (error is UnknownHostException || error is SocketTimeoutException || error is java.net.ConnectException) return OFFLINE
        if (error is NoRelayException) return "No relay serves your account yet. Join a lobby from an invitation first."
        val raw = error.toString() + " " + (error.message ?: "")
        contractMessage(raw)?.let { return humanise(it) }
        if (error is IOException) return OFFLINE
        val humane = humanise(raw)
        return if (humane == raw) fallback else humane
    }

    /** Whether the contract refused because the match is over. */
    fun isFinished(error: Throwable): Boolean = contractMessage(error.toString() + " " + error.message)?.lowercase()?.contains("finished") == true

    /** Whether a shot was refused because the opponent has not placed a fleet yet. */
    fun isOpponentNotReady(error: Throwable): Boolean {
        val raw = (contractMessage(error.toString() + " " + error.message) ?: error.toString()).lowercase()
        return "place ships" in raw || "not committed" in raw || "no commitment" in raw
    }

    private val humanised =
        listOf(
            "player2 is not a valid hex key" to "That is not a valid player key.",
            "cannot create match against self" to "You cannot challenge yourself.",
            "unknown match_id" to "That match no longer exists in this lobby.",
            "match not in pending state" to "That match has already started.",
            "not a player" to "You are not a player in this match.",
            "not your turn" to "It is not your turn yet.",
            "a shot is already pending" to "Your last shot is still being answered.",
            "already shot" to "You have already fired at that square.",
            "out of bounds" to "That square is off the board.",
            "finished" to "This match is already finished.",
        )

    internal fun humanise(message: String): String {
        val lowered = message.lowercase()
        return humanised.firstOrNull { it.first in lowered }?.second ?: message
    }

    /**
     * The contract's `{"kind": …, "data": …}` error, wherever it sits in [raw]: as JSON, or as the
     * decimal UTF-8 bytes of that JSON (what a node puts in an error body).
     */
    @Suppress("LoopWithTooManyJumpStatements")
    internal fun contractMessage(raw: String): String? {
        for (candidate in listOf(raw) + decodedByteRuns(raw)) {
            for (run in balancedObjects(candidate)) {
                val obj = runCatching { Json.parseToJsonElement(run) as? JsonObject }.getOrNull() ?: continue
                val kind = (obj["kind"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: continue
                val data = (obj["data"] as? JsonPrimitive)?.contentOrNull
                if (!data.isNullOrEmpty()) return data
                return if (kind == "Finished") "This match is already finished." else kind
            }
        }
        return null
    }

    @Suppress("NestedBlockDepth", "LoopWithTooManyJumpStatements")
    private fun balancedObjects(text: String): List<String> {
        val out = mutableListOf<String>()
        var i = 0
        while (i < text.length) {
            if (text[i] == '{') {
                var depth = 0
                var inString = false
                var escaped = false
                var j = i
                while (j < text.length) {
                    val c = text[j]
                    when {
                        escaped -> escaped = false
                        c == '\\' -> escaped = true
                        c == '"' -> inString = !inString
                        !inString && c == '{' -> depth++
                        !inString && c == '}' -> {
                            depth--
                            if (depth == 0) {
                                out += text.substring(i, j + 1)
                                break
                            }
                        }
                    }
                    j++
                }
            }
            i++
        }
        return out
    }

    private val byteRun = Regex("""\[(\s*\d{1,3}\s*,){3,}\s*\d{1,3}\s*]""")

    private fun decodedByteRuns(text: String): List<String> =
        byteRun
            .findAll(text)
            .mapNotNull { match ->
                val bytes =
                    match.value
                        .trim('[', ']')
                        .split(',')
                        .map { it.trim().toIntOrNull() ?: return@mapNotNull null }
                if (bytes.any { it > 0xff }) return@mapNotNull null
                String(bytes.map { it.toByte() }.toByteArray(), Charsets.UTF_8)
            }.toList()
}

/** How a person is shown: a short handle from their key, until a name is known. (Swift `Names`.) */
object Names {
    private const val PREFIX = 6
    private const val SUFFIX = 4

    fun short(key: String): String = if (key.length <= PREFIX + SUFFIX) key else "${key.take(PREFIX)}…${key.takeLast(SUFFIX)}"

    /** "You", or "Player 3fa2c1". */
    fun player(
        key: String,
        me: String?,
    ): String = if (me != null && key.equals(me, ignoreCase = true)) "You" else "Player ${key.take(PREFIX)}"

    fun lobby(namespace: AppNamespace): String = namespace.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Lobby ${namespace.id.take(PREFIX)}"
}

/** Where a screen's first load stands. */
sealed interface LoadPhase {
    data object Loading : LoadPhase

    data object Loaded : LoadPhase

    data class Failed(
        val message: String,
    ) : LoadPhase
}

/** A match as the lobby lists it and the match screen opens it. (Swift `MatchRef`.) */
data class MatchRef(
    val namespaceId: String,
    val lobbyContextId: String,
    val matchId: String,
    val contextId: String,
    val opponent: String,
)

internal fun JsonElement?.stringOrNull(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

internal fun JsonElement.primitiveContent(): String? = runCatching { jsonPrimitive.contentOrNull }.getOrNull()
