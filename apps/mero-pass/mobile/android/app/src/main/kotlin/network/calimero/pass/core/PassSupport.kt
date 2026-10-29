package network.calimero.pass.core

import android.content.Context
import android.content.SharedPreferences
import com.calimero.mero.account.NoRelayException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Constants shared with the web app and the contract. (Swift `PassConstants`.) */
object PassConstants {
    /** The registry package and invitation-link slug (`APP_PACKAGE` / `APP_SLUG` on the web). */
    const val PACKAGE_NAME = "com.calimero.mero-pass"

    /** How often an open vault is re-read when the relay cannot stream events, and while this device waits for the key. */
    const val POLL_INTERVAL_MS = 5_000L

    /** Auto-lock choices in minutes, and the default (the web's `AUTO_LOCK_CHOICES`). */
    val AUTO_LOCK_CHOICES = listOf(1, 5, 15, 60)
    const val DEFAULT_AUTO_LOCK_MINUTES = 5

    /** How long a copied secret stays on the clipboard (the web's `CLIPBOARD_CLEAR_MS`). */
    const val CLIPBOARD_SECONDS = 30

    /** Share-link lifetimes (the web's `ShareModal` `EXPIRY`): label to seconds. */
    val SHARE_EXPIRIES = listOf("1 hour" to 3600, "1 day" to 86_400, "7 days" to 604_800)

    /** The shortest share passphrase the web accepts. */
    const val MIN_SHARE_PASSPHRASE = 6
}

/** Where a screen's first load stands. */
sealed interface LoadPhase {
    data object Loading : LoadPhase

    data object Loaded : LoadPhase

    data class Failed(
        val message: String,
    ) : LoadPhase
}

/** An error already in words to show. (Swift `PassModelError`.) */
class PassModelException(
    message: String,
) : Exception(message)

/** A failure, in words a person can act on (the web's `describeError`). (Swift `PassErrorText`.) */
object PassErrorText {
    /** The web's `TRANSIENT`: refusals that clear on their own while a vault just joined syncs. */
    private val transient =
        listOf(
            listOf("not a member of this context") to "Your relay has not finished joining the vault yet.",
            listOf("awaiting state sync", "uninitialized") to "Your relay is still downloading the vault from its peers.",
            listOf("group key not yet delivered", "groupkeypending") to "Your relay is still waiting for the team key from a peer.",
            listOf("no owned identity") to "Your relay has no identity in the vault yet.",
        )

    private val reworded =
        listOf(
            listOf("http 403", "forbidden") to "This session is not allowed to do that.",
            listOf("view-only") to "Your role in this vault can read, not change, its items.",
            listOf("only a vault admin", "admin only") to "Only a vault Admin can do that.",
            listOf("needs at least one admin") to "A vault needs at least one Admin. Promote someone else first.",
        )

    fun describe(error: Throwable): String =
        when (error) {
            is PassModelException, is VaultSessionException -> error.message ?: "Something went wrong."
            is NoRelayException -> "No relay serves your account yet. Join a team from an invitation link to get one."
            is UnknownHostException, is ConnectException -> "You're offline. Check your connection and try again."
            is SocketTimeoutException -> "The relay took too long to answer. Try again."
            is SerializationException -> "The vault answered in a shape this app doesn't understand. Update the app and try again."
            is IOException -> fromText(error.message.orEmpty(), "Couldn't reach the relay. Try again.")
            else -> fromText(error.message ?: error.toString(), "Something went wrong. Try again.")
        }

    private fun fromText(
        text: String,
        fallback: String,
    ): String {
        val lower = text.lowercase()
        (transient + reworded).firstOrNull { (needles, _) -> needles.any { it in lower } }?.let { return it.second }
        return text.ifBlank { fallback }
    }

    /** A refusal that clears on its own while a vault just joined syncs. */
    fun isTransient(error: Throwable): Boolean {
        val text = (error.message ?: error.toString()).lowercase()
        return transient.any { (needles, _) -> needles.any { it in text } }
    }
}

/** Rethrow cancellation; anything else is a failure to show. */
internal inline fun <T> attempt(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }

/** Run [block], turning any failure into a [PassModelException] with words to show. */
internal inline fun <T> worded(block: () -> T): T = attempt(block).getOrElse { throw PassModelException(PassErrorText.describe(it)) }

internal fun String.nullIfBlank(): String? = trim().ifEmpty { null }

/** What this phone remembers outside the Keystore: never a secret. (Swift `PassPreferences`.) */
interface PassPreferences {
    var autoLockMinutes: Int

    /** The public half of this account's recovery key, once one was made or used here. */
    var recoveryKey: RecoveryPublic?
}

/** [PassPreferences] in SharedPreferences. */
class SharedPassPreferences(
    context: Context,
) : PassPreferences {
    private val prefs: SharedPreferences = context.getSharedPreferences("pass.preferences", Context.MODE_PRIVATE)

    override var autoLockMinutes: Int
        get() = prefs.getInt(AUTO_LOCK, 0).takeIf { it in PassConstants.AUTO_LOCK_CHOICES } ?: PassConstants.DEFAULT_AUTO_LOCK_MINUTES
        set(value) = prefs.edit().putInt(AUTO_LOCK, value).apply()

    override var recoveryKey: RecoveryPublic?
        get() {
            val fingerprint = prefs.getString(RECOVERY_FP, null) ?: return null
            val publicKey = prefs.getString(RECOVERY_PUBLIC, null) ?: return null
            return runCatching { RecoveryPublic(Bytes.fromB64(publicKey), fingerprint) }.getOrNull()
        }
        set(value) {
            prefs
                .edit()
                .apply {
                    if (value == null) {
                        remove(RECOVERY_FP)
                        remove(RECOVERY_PUBLIC)
                    } else {
                        putString(RECOVERY_FP, value.fingerprint)
                        putString(RECOVERY_PUBLIC, Bytes.b64(value.publicRaw))
                    }
                }.apply()
        }

    private companion object {
        const val AUTO_LOCK = "autoLockMinutes"
        const val RECOVERY_FP = "recoveryKey.fingerprint"
        const val RECOVERY_PUBLIC = "recoveryKey.publicKey"
    }
}

/** [PassPreferences] in memory, for tests and previews. */
class MemoryPreferences(
    override var autoLockMinutes: Int = PassConstants.DEFAULT_AUTO_LOCK_MINUTES,
    override var recoveryKey: RecoveryPublic? = null,
) : PassPreferences
