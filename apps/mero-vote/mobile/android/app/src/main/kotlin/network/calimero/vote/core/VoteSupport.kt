package network.calimero.vote.core

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.NotLeader
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.ContextContract
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.tee.TeeTrustException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.PollDefinition
import network.calimero.vote.generated.VoteClient
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.text.DateFormat
import java.util.Date
import kotlin.math.roundToInt

/** Constants shared with the web app and the contract. (Swift `VoteConstants`.) */
object VoteConstants {
    /** The registry package and invitation-link slug (`APP_SLUG` on the web). */
    const val PACKAGE_NAME = "com.calimero.mero-vote"

    /** How often an open screen is re-read when the node cannot stream events. */
    const val POLL_INTERVAL_MS = 10_000L

    /** The contract's limits. */
    const val MAX_OPTIONS = 16
    const val MAX_TITLE = 200
    const val MAX_DESCRIPTION = 4000
    const val MAX_OPTION = 200
    const val MAX_NAME = 64

    /** Proof branches one ballot may carry: `2·options + maxChoices − minChoices + 1`. */
    const val MAX_BALLOT_BRANCHES = 38
}

/** The vote client for one voting group (app instance), over the account's session. */
fun voteClient(
    contract: ContextContract,
    contextId: String,
): VoteClient = VoteClient(contract.bound(contextId))

/** A voting group: one context running the contract, in a workspace (namespace). */
data class GroupRef(
    val namespaceId: String,
    val workspaceName: String,
    val contextId: String,
)

/** Where a screen's first load stands. */
sealed interface LoadPhase {
    data object Loading : LoadPhase

    data object Loaded : LoadPhase

    data class Failed(
        val message: String,
    ) : LoadPhase
}

/** An error already in words to show. (Swift `VoteModelError`.) */
class VoteModelException(
    message: String,
) : Exception(message)

/** A failure, in words a person can act on. (Swift `VoteErrorText`.) */
object VoteErrorText {
    @Suppress("CyclomaticComplexMethod")
    fun describe(error: Throwable): String =
        when (error) {
            is VoteModelException -> error.message.orEmpty()
            is SignedOutException -> "You're signed out. Sign in again."
            is ConfirmCancelled, is PasskeyCancelled -> "You cancelled the passkey prompt, so nothing changed."
            is PasskeyRequired -> "This needs your passkey. Keep the app open and try again."
            is AppError -> describe(error)
            is LoginRequired -> "Your session ended. Sign in again."
            is WrongNode, is NotLeader -> "This node can't serve your account right now. Try again in a moment."
            is UnavailableError -> "Your cluster is unavailable (${error.code.lowercase()}). Try again in a moment."
            is ReleaseDeadlineError -> {
                val release = if (error.release.isEmpty()) "A node release" else "Node release ${error.release}"
                "$release is waiting for your approval. Open Account, then Approvals."
            }
            is ConsentStale -> "That approval was already decided or has expired. Refresh and try again."
            is NotFound -> "This voting group isn't on your cluster, or you're no longer a member."
            is TeeTrustException -> "The node could not be verified: ${error.message}"
            is UnknownHostException -> "You're offline. Check your connection and try again."
            is SocketTimeoutException -> "The cluster took too long to answer. Try again."
            is SerializationException ->
                "The voting group answered in a shape this app doesn't understand. Update the app and try again."
            is IOException -> "Couldn't reach the cluster. Try again."
            else -> error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
        }

    /** The contract's refusals (`APP_ERROR {code, fields}`, codes from its ABI). */
    fun describe(app: AppError): String {
        val detail = (app.fields["message"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.nullIfBlank()

        fun with(lead: String) = detail?.let { "$lead ${sentence(it)}" } ?: lead
        return when (app.appCode) {
            "Forbidden" -> with("You can't do that in this voting group.")
            "Phase" -> with("The poll has moved on to another step.")
            "Invalid" -> detail?.let(::sentence) ?: "The voting group refused that request."
            "Crypto" -> with("A proof didn't check out.")
            "NotFound" -> "That poll isn't in this voting group."
            "BadArgs" -> "This app is out of step with the voting group. Update the app and try again."
            else -> detail?.let(::sentence) ?: app.nodeMessage.ifBlank { "The voting group refused that (${app.appCode})." }
        }
    }

    /** [text] with a capital first letter and a full stop. */
    internal fun sentence(text: String): String {
        if (text.isEmpty()) return text
        val capped = text.replaceFirstChar { it.uppercase() }
        return if (capped.endsWith(".") || capped.endsWith("!") || capped.endsWith("?")) capped else "$capped."
    }
}

/** Words and small numbers shared by the screens. (Swift `VoteFormat`.) */
object VoteFormat {
    fun phaseLabel(phase: Phase): String =
        when (phase) {
            Phase.KeyCeremony -> "Key ceremony"
            Phase.Voting -> "Voting"
            Phase.Closing -> "Closing"
            Phase.Closed -> "Closed"
        }

    /** The four steps a poll moves through, as the progress strip labels them. */
    val steps: List<Pair<Phase, String>> =
        listOf(Phase.KeyCeremony to "Key ceremony", Phase.Voting to "Voting", Phase.Closing to "Closing", Phase.Closed to "Tally")

    fun stepIndex(phase: Phase): Int = steps.indexOfFirst { it.first == phase }.coerceAtLeast(0)

    /** "Pick exactly one." and the like, from the poll's bounds. */
    fun ruleText(
        min: UInt,
        max: UInt,
    ): String =
        when {
            min == 1u && max == 1u -> "Pick exactly one."
            min == 0u -> "Pick up to $max."
            else -> "Pick between $min and $max."
        }

    fun isSingleChoice(def: PollDefinition): Boolean = def.minChoices == 1u && def.maxChoices == 1u

    /** `abcdef…1234`, as the web shortens ids. */
    fun short(id: String): String = if (id.length > 11) "${id.take(6)}…${id.takeLast(4)}" else id

    fun initial(name: String): String = name.trim().firstOrNull()?.uppercase() ?: "?"

    fun count(
        n: Int,
        one: String,
        many: String,
    ): String = "$n ${if (n == 1) one else many}"

    /** A stable avatar tone index for a seed (FNV-1a, as iOS). */
    fun tone(
        seed: String,
        tones: Int = 6,
    ): Int {
        var h = 2_166_136_261u
        for (b in seed.toByteArray(Charsets.UTF_8)) {
            h = h xor (b.toUInt() and 0xffu)
            h *= 16_777_619u
        }
        return (h % tones.toUInt()).toInt()
    }

    /** A planned close (milliseconds since the epoch), in the device's words. */
    fun date(ms: ULong): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(ms.toLong()))

    /** A share of the counted ballots, rounded (approval polls can sum past 100%). */
    fun percent(
        count: ULong,
        total: ULong,
    ): Int = if (total == 0uL) 0 else (100.0 * count.toDouble() / total.toDouble()).roundToInt()
}

/** Rethrow cancellation; anything else is a failure to show. */
internal inline fun <T> attempt(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        Result.failure(e)
    }

/** Run [block], turning any failure into a [VoteModelException] with words to show. */
internal inline fun <T> worded(block: () -> T): T = attempt(block).getOrElse { throw VoteModelException(VoteErrorText.describe(it)) }

internal fun String.nullIfBlank(): String? = trim().ifEmpty { null }
