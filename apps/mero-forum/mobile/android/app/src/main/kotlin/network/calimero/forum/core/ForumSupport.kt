package network.calimero.forum.core

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConfirmRequired
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.ContextContract
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.tee.TeeTrustException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import network.calimero.forum.contract.ForumClient
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Constants shared with the web app (`app/src/lib/inviteLink.ts`) and the contract. (Swift `ForumConstants`.) */
object ForumConstants {
    /** The registry package and invitation-link slug (`APP_SLUG` on the web). */
    const val PACKAGE_NAME = "com.calimero.mero-forum"

    /** One page of the feed or of a thread, as on the web. */
    const val PAGE_SIZE: UInt = 20u

    /** How often an open forum is re-read when the node's event stream is down. */
    const val POLL_INTERVAL_MS = 10_000L

    /** The contract's limits (`MAX_TITLE`, `MAX_BODY`, `MAX_NICKNAME`). */
    const val MAX_TITLE = 300
    const val MAX_BODY = 10_000
    const val MAX_NAME = 64
}

/** The forum client for one app instance, over the account's sealed session. */
fun forumClient(
    contract: ContextContract,
    contextId: String,
): ForumClient = ForumClient(contract.bound(contextId))

/** Where a forum lives: the space (org), the forum and its app instance (the same id on 1.0). */
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
            is SignedOutException -> "You're not connected to your cluster. Sign in again."
            is ConfirmCancelled, is PasskeyCancelled -> "The passkey prompt was cancelled."
            is PasskeyRequired, is ConfirmRequired -> "This needs your passkey. Open the app and try again."
            is LoginRequired -> "Your session ended. Sign in again."
            is ReleaseDeadlineError -> "A newer node release needs approval before anything can change. Review it under Spaces."
            is ConsentStale -> "That approval request is out of date. Try again."
            is NotFound -> "This isn't available to you (yet)."
            is WrongNode -> "This node doesn't serve your account. Sign in again to reach your cluster."
            is UnavailableError -> "Your cluster is unavailable right now (${error.reason}). Try again shortly."
            is AppError -> refusal(error.appCode, error.fields) ?: fromText(error.message.orEmpty())
            is TeeTrustException -> "Your cluster's node could not be verified: ${error.message}"
            is UnknownHostException -> "You're offline. Check your connection and try again."
            is SocketTimeoutException -> "Your cluster took too long to answer. Try again."
            is SerializationException ->
                "The forum answered in a shape this app doesn't understand. Update the app and try again."
            is IOException -> "Couldn't reach your cluster. Try again."
            else -> fromText(error.message.orEmpty())
        }

    /** The contract's refusals (`APP_ERROR`): `NotFound {what, id}`, `Forbidden {message}`, `Invalid {message}`. */
    fun refusal(
        code: String,
        fields: JsonObject,
    ): String? {
        fun field(key: String) = (fields[key] as? JsonPrimitive)?.contentOrNull?.nullIfBlank()
        val message = field("message")?.let(::sentence)
        return when (code) {
            "NotFound" -> "This ${field("what") ?: "item"} no longer exists. It may have been deleted."
            "Forbidden" -> message ?: "You're not allowed to do that."
            "Invalid" -> message ?: "That isn't valid. Check it and try again."
            else -> message
        }
    }

    /** [text] with a capital first letter and a full stop. */
    internal fun sentence(text: String): String {
        val capital = text.replaceFirstChar { it.uppercase() }
        return if (capital.endsWith('.') || capital.endsWith('!') || capital.endsWith('?')) capital else "$capital."
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
