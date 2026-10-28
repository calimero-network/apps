package network.calimero.sign.core

import com.calimero.mero.account.NoRelayException
import com.calimero.mero.app.ContextContract
import com.calimero.mero.crypto.Hex
import com.calimero.mero.invite.InviteCodec
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import network.calimero.sign.generated.ContractBytes
import network.calimero.sign.generated.SignClient
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Constants shared with the web app and the contract. (Swift `SignConstants`.) */
object SignConstants {
    /** The registry package and invitation-link slug (`PACKAGE_NAME` on the web). */
    const val PACKAGE_NAME = "com.calimero.mero-sign"

    /** The metadata marker on the namespace that holds the private store (`PERSONAL_KIND`). */
    const val PERSONAL_KIND = "mero-sign:personal"

    /** The personal namespace's name (`PERSONAL_WORKSPACE_NAME`). */
    const val PERSONAL_WORKSPACE_NAME = "Personal"

    /** The restricted subgroup the private context is bound to (`PERSONAL_GROUP_NAME`). */
    const val PERSONAL_GROUP_NAME = "Private"

    /** The private context's `context_name`. */
    const val PRIVATE_CONTEXT_NAME = "default"

    /** How often an open agreement is re-read when the relay cannot stream events. */
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
    fun hex(value: String): String = value.trim().lowercase()

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
    fun describe(error: Throwable): String =
        when {
            error is SignModelException -> error.message.orEmpty()
            error is NoRelayException -> "No relay serves your account yet. Open an invitation link to get one."
            error is UnknownHostException -> "You're offline. Check your connection and try again."
            error is SocketTimeoutException -> "The relay took too long to answer. Try again."
            error is SerializationException -> "The agreement answered in a shape this app doesn't understand. Update the app and try again."
            error is IOException && error.message.isNullOrBlank() -> "Couldn't reach the relay. Try again."
            isSyncing(message(error)) -> "This agreement is still syncing to your account. Give it a moment and try again."
            else -> message(error).ifBlank { "Something went wrong. Try again." }
        }

    fun message(error: Throwable): String = error.message ?: error.toString()

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
