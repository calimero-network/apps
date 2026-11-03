package network.calimero.pass.core

import android.content.Context
import android.content.SharedPreferences
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
import com.calimero.mero.app.PasskeyRequired
import com.calimero.mero.app.SignedOutException
import com.calimero.mero.tee.TeeTrustException
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Constants shared with the web app and the contract. (Swift `PassConstants`.) */
object PassConstants {
    /** The registry package and invitation-link slug (`APP_PACKAGE` / `APP_SLUG` on the web). */
    const val PACKAGE_NAME = "com.calimero.mero-pass"

    /** How often an open vault is re-read when the node cannot stream events, and while this device waits for the key. */
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
            listOf("not a member of this context") to "Your account has not finished joining the vault yet.",
            listOf("awaiting state sync", "uninitialized") to "The vault is still being set up on the cluster.",
            listOf("group key not yet delivered", "groupkeypending") to "The vault is still waiting for the team key.",
            listOf("no owned identity") to "Your account has no identity in the vault yet.",
        )

    private val reworded =
        listOf(
            listOf("http 403", "forbidden") to "This session is not allowed to do that.",
            listOf("view-only") to "Your role in this vault can read, not change, its items.",
            listOf("only a vault admin", "admin only") to "Only a vault Admin can do that.",
            listOf("needs at least one admin") to "A vault needs at least one Admin. Promote someone else first.",
        )

    @Suppress("CyclomaticComplexMethod")
    fun describe(error: Throwable): String =
        when (error) {
            is PassModelException, is VaultSessionException -> error.message ?: "Something went wrong."
            is SignedOutException -> "You're signed out. Sign in again."
            is ConfirmCancelled, is PasskeyCancelled -> "You cancelled the passkey prompt, so nothing changed."
            is PasskeyRequired -> "This needs your passkey. Keep the app open and try again."
            is AppError -> describe(error)
            is LoginRequired -> "Your session ended. Sign in again."
            is WrongNode, is NotLeader -> "This node can't serve your account right now. Try again in a moment."
            is UnavailableError -> "Your cluster is unavailable (${error.code.lowercase()}). Try again in a moment."
            is ReleaseDeadlineError -> {
                val release = if (error.release.isEmpty()) "A node release" else "Node release ${error.release}"
                "$release is waiting for your approval. Open Security, then Approvals."
            }
            is ConsentStale -> "That approval was already decided or has expired. Refresh and try again."
            is NotFound -> "This vault isn't on your cluster, or you're no longer a member."
            is TeeTrustException -> "The node could not be verified: ${error.message}"
            is UnknownHostException, is ConnectException -> "You're offline. Check your connection and try again."
            is SocketTimeoutException -> "The cluster took too long to answer. Try again."
            is SerializationException -> "The vault answered in a shape this app doesn't understand. Update the app and try again."
            is IOException -> fromText(error.message.orEmpty(), "Couldn't reach the cluster. Try again.")
            else -> fromText(error.message ?: error.toString(), "Something went wrong. Try again.")
        }

    /**
     * The contract's refusals (`APP_ERROR {code, fields: {message}}`). Its messages are v1's texts,
     * so the known ones are reworded as before; the code is the fallback. (Swift `describe(app:)`.)
     */
    fun describe(app: AppError): String {
        val detail = (app.fields["message"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull.orEmpty()
        val lower = detail.lowercase()
        reworded.firstOrNull { (needles, _) -> needles.any { it in lower } }?.let { return it.second }
        return when (app.appCode) {
            "Forbidden" -> if (detail.isEmpty()) "Your role in this vault can't do that." else sentence(detail)
            "NotFound" -> if (detail.isEmpty()) "That item or member isn't in this vault." else sentence(detail)
            "Conflict" -> if (detail.isEmpty()) "Someone changed this at the same time. Refresh and try again." else sentence(detail)
            "BadArgs" -> "This app is out of step with the vault. Update the app and try again."
            else -> if (detail.isEmpty()) "The vault refused that (${app.appCode})." else sentence(detail)
        }
    }

    /** [text] with a capital first letter and a full stop. */
    internal fun sentence(text: String): String {
        if (text.isEmpty()) return text
        val capped = text.replaceFirstChar { it.uppercase() }
        return if (capped.endsWith(".") || capped.endsWith("!") || capped.endsWith("?")) capped else "$capped."
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
