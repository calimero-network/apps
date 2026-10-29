package network.calimero.pass.core

import java.net.URI
import java.net.URLDecoder
import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Authenticator parameters, from a bare base32 seed or an `otpauth://totp/…` URI. */
data class TotpParams(
    val secret: String,
    val digits: Int,
    val period: Int,
    val algorithm: Algorithm,
    val issuer: String? = null,
    val account: String? = null,
) {
    enum class Algorithm(
        val label: String,
        val mac: String,
    ) {
        SHA1("SHA-1", "HmacSHA1"),
        SHA256("SHA-256", "HmacSHA256"),
        SHA512("SHA-512", "HmacSHA512"),
    }

    override fun toString(): String = "TotpParams($digits digits, ${period}s)"
}

/** Authenticator codes (RFC 6238), as the web's `app/src/lib/totp.ts`. (Swift `Totp`.) */
object Totp {
    private const val B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    fun base32Decode(input: String): ByteArray? {
        val clean = input.uppercase().filter { !it.isWhitespace() && it != '=' && it != '-' }
        val out = ArrayList<Byte>()
        var bits = 0
        var value = 0
        for (ch in clean) {
            val index = B32.indexOf(ch)
            if (index < 0) return null
            value = ((value shl 5) or index) and 0xFFFF
            bits += 5
            if (bits >= 8) {
                out.add(((value ushr (bits - 8)) and 0xFF).toByte())
                bits -= 8
            }
        }
        return out.toByteArray()
    }

    /** A seed or an otpauth URI; `null` for anything that is neither. */
    fun parse(input: String): TotpParams? {
        val text = input.trim()
        if (text.isEmpty()) return null
        if (text.lowercase().startsWith("otpauth://")) {
            val uri = runCatching { URI(text) }.getOrNull() ?: return null
            if (uri.host?.lowercase() != "totp") return null
            val query = LinkedHashMap<String, String>()
            for (pair in (uri.rawQuery ?: "").split('&')) {
                if (pair.isEmpty()) continue
                val parts = pair.split('=', limit = 2)
                val name = URLDecoder.decode(parts[0], "UTF-8")
                if (!query.containsKey(name)) query[name] = URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
            }
            val secret = query["secret"]
            if (secret.isNullOrEmpty() || base32Decode(secret) == null) return null
            val alg = (query["algorithm"] ?: "SHA1").uppercase()
            val algorithm =
                when (alg) {
                    "SHA256" -> TotpParams.Algorithm.SHA256
                    "SHA512" -> TotpParams.Algorithm.SHA512
                    else -> TotpParams.Algorithm.SHA1
                }
            val label = (uri.path ?: "").trimStart('/')
            val issuerFromLabel: String?
            val account: String
            if (label.contains(':')) {
                val parts = label.split(':')
                issuerFromLabel = parts[0]
                account = parts[1]
            } else {
                issuerFromLabel = null
                account = label
            }
            return TotpParams(
                secret = secret,
                digits = query["digits"]?.toIntOrNull()?.takeIf { it != 0 } ?: 6,
                period = query["period"]?.toIntOrNull()?.takeIf { it != 0 } ?: 30,
                algorithm = algorithm,
                issuer = query["issuer"] ?: issuerFromLabel,
                account = account.ifEmpty { null },
            )
        }
        val bytes = base32Decode(text) ?: return null
        if (bytes.isEmpty()) return null
        return TotpParams(secret = text, digits = 6, period = 30, algorithm = TotpParams.Algorithm.SHA1)
    }

    /** The code at [atMs], zero-padded to `digits`. */
    fun code(
        params: TotpParams,
        atMs: Long,
    ): String {
        val key = base32Decode(params.secret) ?: ByteArray(0)
        val counter = atMs / 1000 / params.period
        val mac =
            Mac
                .getInstance(params.algorithm.mac)
                .apply { init(SecretKeySpec(if (key.isEmpty()) ByteArray(1) else key, params.algorithm.mac)) }
                .doFinal(ByteBuffer.allocate(8).putLong(counter).array())
        val offset = mac[mac.size - 1].toInt() and 0x0F
        val bin =
            ((mac[offset].toInt() and 0x7F) shl 24) or
                ((mac[offset + 1].toInt() and 0xFF) shl 16) or
                ((mac[offset + 2].toInt() and 0xFF) shl 8) or
                (mac[offset + 3].toInt() and 0xFF)
        var modulus = 1L
        repeat(params.digits) { modulus *= 10 }
        return (bin.toLong() % modulus).toString().padStart(params.digits, '0')
    }

    /** Seconds left in the current period. */
    fun secondsRemaining(
        period: Int,
        atMs: Long,
    ): Int = period - ((atMs / 1000) % period).toInt()
}
