package network.calimero.crm.core

import com.calimero.mero.account.NoRelayException
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.http.AuthRevokedException
import com.calimero.mero.http.NetworkException
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.relay.IntentRefusedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import network.calimero.crm.generated.ContextContractCalling
import network.calimero.crm.generated.CrmClient
import java.io.IOException

/** The client for one pipeline (one context), over the account's relay. */
fun crmClient(
    backend: MeroAppBackend,
    contextId: String,
): CrmClient {
    // The generated client declares its own `ContextContractCalling`; the SDK's bound contract
    // has exactly its two methods.
    val bound = backend.contract.bound(contextId)
    return CrmClient(
        object : ContextContractCalling {
            override suspend fun query(
                method: String,
                argsJson: String,
            ): String = withContext(Dispatchers.IO) { bound.query(method, argsJson) }

            override suspend fun execute(
                method: String,
                argsJson: String,
            ): String = withContext(Dispatchers.IO) { bound.execute(method, argsJson) }
        },
    )
}

/**
 * Accounts as the app sees them. The session names an account in hex, a contract stamps
 * `created_by` / `author` in base58, and the web app stores a deal's `owner` as whichever its node
 * reported; every comparison goes through [canonical] (the web's `canonicalAccount`).
 */
object Account {
    /** 64 lowercase hex for either spelling of a 32-byte account, else null. */
    fun canonical(id: String?): String? {
        val s = id?.trim().orEmpty()
        if (s.isEmpty()) return null
        if (s.length == HEX_LEN && s.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return s.lowercase()
        val bytes = InviteCodec.base58Decode(s) ?: return null
        if (bytes.size != BYTES) return null
        return bytes.joinToString("") { "%02x".format(it.toInt() and BYTE_MASK) }
    }

    /** Whether two ids name the same account, whichever encoding each is in. */
    fun same(
        a: String?,
        b: String?,
    ): Boolean {
        val ca = canonical(a) ?: return false
        return ca == canonical(b)
    }

    /** `5926f2…1334`: an id shortened for display when nothing names it. */
    fun short(id: String): String {
        val s = id.trim()
        return if (s.length <= SHORT_MIN) s else s.take(SHORT_HEAD) + "…" + s.takeLast(SHORT_TAIL)
    }

    private const val HEX_LEN = 64
    private const val BYTES = 32
    private const val BYTE_MASK = 0xff
    private const val SHORT_MIN = 11
    private const val SHORT_HEAD = 6
    private const val SHORT_TAIL = 4
}

/** Errors the app raises itself. */
sealed class CrmException(
    message: String,
) : Exception(message) {
    class NoApplication : CrmException("Mero CRM is not installed for your account yet. Try again in a moment.")

    class NotAnInvitation : CrmException("That is not a Mero CRM invitation link.")

    class InvalidValue : CrmException("Value must be a number, e.g. 12000 or 12k.")

    class InvalidCurrency : CrmException("Use a three-letter currency code, e.g. USD or EUR.")
}

/** Words a person can act on, for any failure the app sees. */
object ErrorText {
    fun describe(error: Throwable): String =
        when (error) {
            is NoRelayException -> "No relay serves your account yet. Join a workspace with an invitation link first."
            is IntentRefusedException -> "The relay refused this (${error.status}): ${error.reason}"
            is NetworkException -> "The relay can't be reached: ${error.message}"
            is AuthRevokedException -> "Your session was revoked. Sign out and sign in again."
            is SerializationException ->
                "The pipeline answered in a shape this app does not read. It may run a different version of Mero CRM."
            is IOException -> "The relay can't be reached. Check your connection and try again."
            else -> error.message ?: error.toString()
        }

    /**
     * The two transient failures a context reports while its state is still replicating to this
     * account (the web's `isContextWarmingUp`): show "syncing", not an error, and try again.
     */
    fun isWarmingUp(error: Throwable): Boolean {
        val text = (describe(error) + " " + error.toString()).lowercase()
        return WARMUP_PHRASES.any { it in text }
    }

    private val WARMUP_PHRASES =
        listOf(
            "context state not initialized",
            "awaiting state sync",
            "group key not yet delivered",
            "uninitialized",
            "groupkeypending",
        )
}
