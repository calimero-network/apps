package network.calimero.forum.core

import com.calimero.mero.account.NoRelayException
import com.calimero.mero.app.ContextContract
import kotlinx.serialization.SerializationException
import network.calimero.forum.generated.ContextContractCalling
import network.calimero.forum.generated.ForumClient
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Constants shared with the web app (`app/src/lib/inviteLink.ts`) and the contract. (Swift `ForumConstants`.) */
object ForumConstants {
    /** The registry package and invitation-link slug (`APP_SLUG` on the web). */
    const val PACKAGE_NAME = "com.calimero.mero-forum"

    /** One page of the feed or of a thread, as on the web. */
    const val PAGE_SIZE: UInt = 20u

    /** How often an open forum is re-read when the relay cannot stream events. */
    const val POLL_INTERVAL_MS = 10_000L

    /** The contract's limits (`MAX_TITLE`, `MAX_BODY`, `MAX_NICKNAME`). */
    const val MAX_TITLE = 300
    const val MAX_BODY = 10_000
    const val MAX_NAME = 64
}

/**
 * The SDK's bound contract, as the generated client's transport. The two interfaces have the same
 * methods; they are separate types only because the generated file declares its own.
 */
class ForumTransport(
    private val bound: com.calimero.mero.app.ContextContractCalling,
) : ContextContractCalling {
    override suspend fun query(
        method: String,
        argsJson: String,
    ): String = bound.query(method, argsJson)

    override suspend fun execute(
        method: String,
        argsJson: String,
    ): String = bound.execute(method, argsJson)
}

/** The forum client for one context, over the account's relay. */
fun forumClient(
    contract: ContextContract,
    contextId: String,
): ForumClient = ForumClient(ForumTransport(contract.bound(contextId)))

/** Where a forum lives: the space (namespace), the forum (subgroup) and its context. */
data class ForumRef(
    val namespaceId: String,
    val spaceName: String,
    val forumId: String,
    val forumName: String,
    val contextId: String,
)

/** Feed order: the contract's `sort` argument. */
enum class FeedSort(
    val wire: String,
    val label: String,
) {
    NEW("new", "Latest"),
    TOP("top", "Top"),
}

/** Where a screen's first load stands. */
sealed interface LoadPhase {
    data object Loading : LoadPhase

    data object Loaded : LoadPhase

    data class Failed(
        val message: String,
    ) : LoadPhase
}

/**
 * The name this person posts under, kept on the device and pushed to each forum's contract
 * (`set_nickname`), as the web app keeps it in localStorage.
 */
interface NameStore {
    var name: String
}

/** [NameStore] in memory, for tests and previews. */
class MemoryNameStore(
    override var name: String = "",
) : NameStore

/** An error already in words to show. */
class ForumModelException(
    message: String,
) : Exception(message)

/** A failure, in words a person can act on. (Swift `ForumErrorText`.) */
object ForumErrorText {
    fun describe(error: Throwable): String =
        when (error) {
            is ForumModelException -> error.message.orEmpty()
            is NoRelayException -> "No relay serves your account yet. Join a space from an invitation link to get one."
            is UnknownHostException -> "You're offline. Check your connection and try again."
            is SocketTimeoutException -> "The relay took too long to answer. Try again."
            is SerializationException ->
                "The forum answered in a shape this app doesn't understand. Update the app and try again."
            is IOException -> error.message?.takeIf { it.isNotBlank() } ?: "Couldn't reach the relay. Try again."
            else -> fromText(error.message.orEmpty())
        }

    private fun fromText(text: String): String =
        when {
            text.contains("only a moderator", ignoreCase = true) -> "Only a moderator can do that."
            text.contains("needs at least one moderator", ignoreCase = true) -> "A forum needs at least one moderator."
            text.isBlank() -> "Something went wrong. Try again."
            else -> text
        }
}

internal fun String.nullIfBlank(): String? = trim().ifEmpty { null }
