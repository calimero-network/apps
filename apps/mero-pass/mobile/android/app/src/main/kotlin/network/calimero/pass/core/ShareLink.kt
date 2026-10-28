package network.calimero.pass.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.URLDecoder
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * One secret shared with someone outside the team: the web's `app/src/lib/shareLink.ts`, same
 * format, so a link made here opens on the web's `/share` page. The secret travels sealed in the
 * URL fragment; the key is in the link (`k=`) or derived from a passphrase (PBKDF2-SHA256,
 * 600,000 rounds) told to the recipient another way. (Swift `ShareLink`.)
 */
object ShareLink {
    const val ITERATIONS = 600_000

    /** Where the web app opens share links. */
    const val WEB_BASE = "https://mero-pass.vercel.app/share"

    @Serializable
    data class Payload(
        val name: String,
        val kind: String,
        val fields: Map<String, String>,
        /** Milliseconds since the epoch. */
        val expiresAt: Long,
        val sharedBy: String? = null,
    ) {
        override fun toString(): String = "Payload($kind, …)"
    }

    class Failure(
        message: String,
    ) : Exception(message)

    private val json =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }

    /** The fragment (everything after `#`). [iv], [key] and [salt] are for the test vectors. */
    fun createFragment(
        payload: Payload,
        passphrase: String? = null,
        iv: ByteArray? = null,
        key: ByteArray? = null,
        salt: ByteArray? = null,
    ): String {
        val nonce = iv ?: Bytes.random(12)
        val plain = json.encodeToString(Payload.serializer(), payload).toByteArray(Charsets.UTF_8)
        if (!passphrase.isNullOrEmpty()) {
            val s = salt ?: Bytes.random(16)
            val ct = PassCrypto.gcmSeal(pbkdf2(passphrase, s), nonce, plain)
            return "v=1&p=1&s=${Bytes.b64url(s)}&iv=${Bytes.b64url(nonce)}&d=${Bytes.b64url(ct)}"
        }
        val raw = key ?: Bytes.random(32)
        val ct = PassCrypto.gcmSeal(raw, nonce, plain)
        return "v=1&iv=${Bytes.b64url(nonce)}&d=${Bytes.b64url(ct)}&k=${Bytes.b64url(raw)}"
    }

    fun url(fragment: String): String = "$WEB_BASE#$fragment"

    fun needsPassphrase(fragment: String): Boolean = params(fragment)["p"] == "1"

    fun openFragment(
        fragment: String,
        passphrase: String? = null,
        now: Long = System.currentTimeMillis(),
    ): Payload {
        val q = params(fragment.removePrefix("#"))
        if (q["v"] != "1") throw Failure("This is not a Mero Pass share link.")
        val iv = q["iv"]
        val data = q["d"]
        if (iv == null || data == null) throw Failure("This link is incomplete.")
        val key =
            if (q["p"] == "1") {
                val salt = q["s"]
                if (salt == null || passphrase.isNullOrEmpty()) throw Failure("This link needs a passphrase.")
                pbkdf2(passphrase, Bytes.fromB64url(salt))
            } else {
                Bytes.fromB64url(q["k"] ?: throw Failure("This link is missing its key."))
            }
        val payload =
            try {
                val plain = PassCrypto.gcmOpen(key, Bytes.fromB64url(iv), Bytes.fromB64url(data))
                json.decodeFromString(Payload.serializer(), String(plain, Charsets.UTF_8))
            } catch (e: Exception) {
                throw Failure("Wrong passphrase, or the link was altered.")
            }
        if (now > payload.expiresAt) throw Failure("This link has expired.")
        return payload
    }

    private fun params(fragment: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (pair in fragment.split('&')) {
            if (pair.isEmpty()) continue
            val parts = pair.split('=', limit = 2)
            val name = URLDecoder.decode(parts[0], "UTF-8")
            if (!out.containsKey(name)) out[name] = if (parts.size > 1) URLDecoder.decode(parts[1], "UTF-8") else ""
        }
        return out
    }

    /** PBKDF2-HMAC-SHA256 to a 32-byte AES key, as WebCrypto's `deriveKey`. */
    internal fun pbkdf2(
        passphrase: String,
        salt: ByteArray,
        rounds: Int = ITERATIONS,
    ): ByteArray {
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, rounds, 256)
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }
}
