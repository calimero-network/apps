package network.calimero.pass.core

/**
 * The recovery key: a P-256 key pair whose private scalar is shown once, as a code, and then
 * forgotten. The web's `app/src/lib/recoveryKey.ts`, same format: Crockford base32 of `d`
 * (32 bytes) and the first 3 bytes of the key's fingerprint, 56 characters in groups of 4.
 * (Swift `RecoveryCode`.)
 */
object RecoveryCode {
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private const val CODE_BYTES = 35
    private const val PREFIX_BYTES = 3

    class Failure(
        message: String,
    ) : Exception(message) {
        companion object {
            val LENGTH get() = Failure("A recovery code has 56 characters.")
            val NO_MATCH get() = Failure("That code does not match a recovery key in any of your vaults.")
            val NOTHING_OPENED get() = Failure("That code did not open any vault. Check it for typos.")

            fun character(c: Char) = Failure("\"$c\" is not in a recovery code.")
        }
    }

    fun encode(bytes: ByteArray): String {
        var bits = 0
        var value = 0
        val out = StringBuilder()
        for (b in bytes) {
            value = ((value shl 8) or (b.toInt() and 0xFF)) and 0xFFFF
            bits += 8
            while (bits >= 5) {
                out.append(ALPHABET[(value ushr (bits - 5)) and 31])
                bits -= 5
            }
        }
        if (bits > 0) out.append(ALPHABET[(value shl (5 - bits)) and 31])
        return out.chunked(4).joinToString("-")
    }

    /** Case, dashes and spaces are ignored; O reads as 0, I and L as 1. */
    fun decode(text: String): ByteArray {
        val clean =
            text
                .uppercase()
                .filter { !it.isWhitespace() && it != '-' }
                .map {
                    when (it) {
                        'O' -> '0'
                        'I', 'L' -> '1'
                        else -> it
                    }
                }
        if (clean.size != (CODE_BYTES * 8 + 4) / 5) throw Failure.LENGTH
        val out = ArrayList<Byte>(CODE_BYTES)
        var bits = 0
        var value = 0
        for (c in clean) {
            val v = ALPHABET.indexOf(c)
            if (v < 0) throw Failure.character(c)
            value = ((value shl 5) or v) and 0xFFFF
            bits += 5
            if (bits >= 8) {
                out.add(((value ushr (bits - 8)) and 0xFF).toByte())
                bits -= 8
            }
        }
        return out.toByteArray()
    }

    /** A new recovery key: the code to show once, and the public half to keep. */
    fun create(): Pair<String, RecoveryPublic> {
        val pair = DeviceKeyPair.generate()
        val fingerprint = PassCrypto.fingerprint(pair.publicRaw)
        val bytes = pair.scalar + Bytes.fromHex(fingerprint.take(PREFIX_BYTES * 2))
        val code = encode(bytes)
        bytes.fill(0)
        return code to RecoveryPublic(pair.publicRaw, fingerprint)
    }

    /**
     * Rebuild the recovery key pair from its code and the registered recovery device it belongs
     * to; `null` when no candidate matches.
     *
     * Unlike iOS (CryptoKit derives the public point from `d` and compares), the platform's
     * java.security cannot derive a public key from a scalar, so the candidate whose fingerprint
     * carries the code's prefix is taken with its registered public key. A code whose scalar does
     * not belong to that key then opens no wrap (the ECDH secret differs), so a restore with it
     * hands nothing over and ends in [Failure.NOTHING_OPENED].
     */
    fun pair(
        code: String,
        candidates: List<DeviceRecord>,
    ): Pair<DeviceKeyPair, String>? {
        val bytes = decode(code)
        val prefix = Bytes.hex(bytes.copyOfRange(32, bytes.size))
        val scalar = bytes.copyOfRange(0, 32)
        try {
            for (c in candidates) {
                if (c.kind != DeviceKind.RECOVERY.wire || !c.fingerprint.startsWith(prefix)) continue
                val raw = runCatching { Bytes.fromB64(c.publicKey) }.getOrNull() ?: continue
                if (raw.size != 65 || raw[0] != 4.toByte()) continue
                val pair = runCatching { DeviceKeyPair.fromScalar(scalar, raw) }.getOrNull() ?: continue
                return pair to c.fingerprint
            }
            return null
        } finally {
            scalar.fill(0)
            bytes.fill(0)
        }
    }
}

/** The public half of a recovery key, remembered so vaults opened later get it. */
class RecoveryPublic(
    val publicRaw: ByteArray,
    val fingerprint: String,
) {
    override fun equals(other: Any?): Boolean = other is RecoveryPublic && other.fingerprint == fingerprint

    override fun hashCode(): Int = fingerprint.hashCode()
}
