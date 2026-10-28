package network.calimero.pass.core

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Encodings and digests the web's `crypto.ts` uses, byte for byte: standard base64 with padding
 * (`btoa`), lower-case hex, base64url without padding. (Swift `Bytes`.)
 */
object Bytes {
    private val random = SecureRandom()

    fun b64(data: ByteArray): String = Base64.getEncoder().encodeToString(data)

    fun fromB64(text: String): ByteArray =
        try {
            Base64.getDecoder().decode(text)
        } catch (e: IllegalArgumentException) {
            throw PassCryptoException("Malformed base64.")
        }

    fun b64url(data: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(data)

    fun fromB64url(text: String): ByteArray =
        try {
            Base64.getUrlDecoder().decode(text.trimEnd('='))
        } catch (e: IllegalArgumentException) {
            throw PassCryptoException("Malformed base64.")
        }

    fun hex(data: ByteArray): String = data.joinToString("") { "%02x".format(it.toInt() and 0xFF) }

    fun fromHex(text: String): ByteArray {
        if (text.length % 2 != 0) throw PassCryptoException("Malformed hex.")
        return ByteArray(text.length / 2) { i ->
            val byte = text.substring(i * 2, i * 2 + 2).toIntOrNull(16) ?: throw PassCryptoException("Malformed hex.")
            byte.toByte()
        }
    }

    fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

    /** Bytes from the platform's CSPRNG. */
    fun random(count: Int): ByteArray = ByteArray(count).also { random.nextBytes(it) }
}

/** A malformed input, or a key that does not fit. Never carries key material. */
class PassCryptoException(
    message: String,
) : Exception(message)
