package network.calimero.sign.core

import com.calimero.mero.AppError
import com.calimero.mero.CalimeroError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.PasskeyCancelled
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.UnavailableError
import com.calimero.mero.WrongNode
import com.calimero.mero.app.ContextContract
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.crypto.Hex
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.tee.TeeTrustException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import network.calimero.sign.generated.ContractBytes
import network.calimero.sign.generated.client.SignClient
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Constants shared with the web app and the contract. (Swift `SignConstants`.) */
object SignConstants {
    /** The registry package and invitation-link slug (`PACKAGE_NAME` on the web). */
    const val PACKAGE_NAME = "com.calimero.mero-sign"

    /** The name of the account's signature-library instance (`LIBRARY_NAME`): owned by the account, in no organization. */
    const val LIBRARY_NAME = "mero-sign:library"

    /** The library's `contextName`. */
    const val PRIVATE_CONTEXT_NAME = "default"

    /** How often an open agreement is re-read. */
    const val POLL_INTERVAL_MS = 10_000L
}

/** The contract client for one context: the generated client takes the SDK's bound contract directly. */
fun signClient(
    contract: ContextContract,
    contextId: String,
): SignClient = SignClient(contract.bound(contextId))

/**
 * A `[u8; 32]` id as the contract hands it back — text (hex, or a previous web build's base58) or a
 * byte array — as the lowercase hex the contract's parsers take back. (Swift `ContractBytes.hex`.)
 */
val ContractBytes.hex: String
    get() =
        when (this) {
            is ContractBytes.Raw -> Hex.encode(ByteArray(value.size) { value[it].toByte() })
            is ContractBytes.Text -> SignIds.blobHex(value).ifEmpty { SignIds.hex(value) }
        }

/** Ids as the contract takes them back: 32 bytes, lowercase hex. (Swift `SignIds`.) */
object SignIds {
    /** An account or app id, trimmed; a 64-hex id lowercased. Any other id is kept as the node spelled it. */
    fun hex(value: String): String {
        val trimmed = value.trim()
        return if (Hex.isHex32(trimmed.lowercase())) trimmed.lowercase() else trimmed
    }

    fun hex(value: ContractBytes): String = value.hex

    fun same(
        a: ContractBytes,
        b: String,
    ): Boolean = same(a.hex, b)

    fun same(
        a: ContractBytes,
        b: ContractBytes,
    ): Boolean = same(a.hex, b.hex)

    fun blobHex(value: ContractBytes): String = value.hex.takeIf { it.length == 64 }.orEmpty()

    fun same(
        a: String,
        b: String,
    ): Boolean {
        val x = hex(a)
        return x.isNotEmpty() && x == hex(b)
    }

    /** A blob id as hex, also accepting the base58 a previous web build wrote. Empty otherwise. */
    fun blobHex(value: String): String {
        var trimmed = value.trim()
        if (trimmed.startsWith("0x")) trimmed = trimmed.drop(2)
        if (Hex.isHex32(trimmed.lowercase())) return trimmed.lowercase()
        val bytes = InviteCodec.base58Decode(trimmed)
        return if (bytes != null && bytes.size == 32) Hex.encode(bytes) else ""
    }

    /** Shortened for display, keeping both ends. */
    fun short(value: String): String {
        val id = hex(value)
        return if (id.length > 14) "${id.take(8)}…${id.takeLast(6)}" else id
    }
}

/** Where a screen's first load stands. */
sealed interface LoadPhase {
    data object Loading : LoadPhase

    data object Loaded : LoadPhase

    data class Failed(
        val message: String,
    ) : LoadPhase
}

/** An error already in words to show. */
class SignModelException(
    message: String,
) : Exception(message)

/** A failure, in words a person can act on. (Swift `SignErrorText`.) */
object SignErrorText {
    @Suppress("CyclomaticComplexMethod")
    fun describe(error: Throwable): String =
        when {
            error is SignModelException -> error.message.orEmpty()
            error is ReleaseDeadlineError -> {
                val release = if (error.release.isEmpty()) "a node release" else "node release ${error.release}"
                "Your cluster takes no new work until $release is approved. Review it under Needs your approval."
            }
            error is NotFound -> "This isn't shared with you, or it was deleted."
            error is LoginRequired || error is SignedOutException -> "Your session ended. Sign in again."
            error is WrongNode -> "This node doesn't serve your workspace. Try another node of the cluster."
            error is UnavailableError -> "Your cluster is busy (${error.reason}). Try again shortly."
            error is ConfirmCancelled || error is PasskeyCancelled -> "The passkey prompt was cancelled, so nothing changed."
            error is ConsentStale -> "What you were approving changed in the meantime. Review it again under Needs your approval."
            error is AppError -> appError(error)
            error is CalimeroError -> error.nodeMessage.ifEmpty { error.code }
            error is TeeTrustException -> "The node could not be verified: ${error.message}"
            error is UnknownHostException -> "You're offline. Check your connection and try again."
            error is SocketTimeoutException -> "Your cluster took too long to answer. Try again."
            error is SerializationException -> "The agreement answered in a shape this app doesn't understand. Update the app and try again."
            error is IOException && error.message.isNullOrBlank() -> "Couldn't reach your cluster. Try again."
            isSyncing(message(error)) -> "This agreement is still syncing to your account. Give it a moment and try again."
            else -> message(error).ifBlank { "Something went wrong. Try again." }
        }

    /** The contract's own refusals (`422 APP_ERROR`): `NotFound {what, id}`; `Invalid`, `Forbidden`, `Conflict` with v1's sentence. */
    fun appError(error: AppError): String {
        val message = (error.fields["message"] as? JsonPrimitive)?.contentOrNull?.let(::sentence)
        return when (error.appCode) {
            "NotFound" -> "That ${(error.fields["what"] as? JsonPrimitive)?.contentOrNull ?: "item"} isn't there any more. Pull to refresh."
            "Forbidden" -> message ?: "You can't do that in this agreement."
            "Conflict" -> message ?: "Someone changed this first. Pull to refresh and try again."
            else -> message ?: error.nodeMessage.ifEmpty { "The agreement refused this (${error.appCode})." }
        }
    }

    fun sentence(text: String): String {
        if (text.isEmpty()) return text
        val body = text.replaceFirstChar { it.uppercase() }
        return if (body.endsWith(".")) body else "$body."
    }

    /** The contract's `Conflict` (already registered, already joined, a stale version). */
    fun isConflict(error: Throwable): Boolean = (error as? AppError)?.appCode == "Conflict"

    fun isForbidden(error: Throwable): Boolean = (error as? AppError)?.appCode == "Forbidden"

    fun message(error: Throwable): String =
        (error as? AppError)?.let { (it.fields["message"] as? JsonPrimitive)?.contentOrNull } ?: error.message ?: error.toString()

    fun isSyncing(text: String): Boolean = text.contains("uninitialized", ignoreCase = true) || text.contains("syncing state", ignoreCase = true)

    fun isSyncing(error: Throwable): Boolean = isSyncing(message(error))
}

/** Rethrow cancellation; anything else is a failure to handle. */
internal inline fun <T> attempt(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }

internal fun String.trimmedOrNull(): String? = trim().ifEmpty { null }
