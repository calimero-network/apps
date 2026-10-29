package network.calimero.pass.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// End-to-end encryption for a vault: the native twin of the web's
// `packages/mero-pass/src/crypto.ts`, byte-compatible with it (and with iOS `PassCrypto.swift`).
// `mobile/test-vectors/vectors.json`, written by running the web's own code, holds all three to
// that.
//
//   device key   ECDH P-256, one per phone, sealed under an Android Keystore key.
//   vault key    32 random bytes, AES-256-GCM. keyId = hex(SHA-256(key)).
//   key wrap     ECIES: an ephemeral P-256 key agrees with the recipient's device key,
//                HKDF-SHA256 (salt = epk || recipient public, info "mero-pass/key-wrap/v1")
//                derives an AES-256-GCM key, which seals the vault key, key id as associated data.
//   field seal   AES-256-GCM under the vault key, "<secretId>\0<field>" as associated data:
//                `mp1.<keyId>.<iv>.<ciphertext+tag>`.
//
// Everything here is the platform's own java.security / javax.crypto; HKDF (RFC 5869) is two
// HMAC-SHA256 calls. Nothing logs, prints or describes a key or a plaintext.

/** P-256 curve parameters. */
internal object P256 {
    val params: ECParameterSpec by lazy {
        AlgorithmParameters
            .getInstance("EC")
            .apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)
    }

    fun fixed32(value: BigInteger): ByteArray {
        val raw = value.toByteArray()
        return when {
            raw.size == 32 -> raw
            raw.size > 32 -> raw.copyOfRange(raw.size - 32, raw.size)
            else -> ByteArray(32 - raw.size) + raw
        }
    }

    /** Raw uncompressed point, `04 || x || y`, as WebCrypto exports it. */
    fun raw(key: ECPublicKey): ByteArray = byteArrayOf(4) + fixed32(key.w.affineX) + fixed32(key.w.affineY)

    fun publicKey(raw: ByteArray): ECPublicKey {
        if (raw.size != 65 || raw[0] != 4.toByte()) throw PassCryptoException("Malformed public key.")
        val point = ECPoint(BigInteger(1, raw.copyOfRange(1, 33)), BigInteger(1, raw.copyOfRange(33, 65)))
        return try {
            KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, params)) as ECPublicKey
        } catch (e: java.security.GeneralSecurityException) {
            throw PassCryptoException("Malformed public key.")
        }
    }

    fun privateKey(scalar: ByteArray): ECPrivateKey {
        if (scalar.size != 32) throw PassCryptoException("Malformed private key.")
        return KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, scalar), params)) as ECPrivateKey
    }
}

/**
 * This phone's key pair. Java cannot derive the public point from the private scalar with the
 * platform's API, so the pair carries both halves (the Keystore-sealed record stores both).
 */
class DeviceKeyPair(
    val privateKey: ECPrivateKey,
    /** Raw uncompressed point, 65 bytes. */
    val publicRaw: ByteArray,
) {
    /** The 32-byte private scalar, for the sealed store and the recovery code only. */
    val scalar: ByteArray get() = P256.fixed32(privateKey.s)

    // Never print key material, even by accident in a log or a test failure.
    override fun toString(): String = "DeviceKeyPair(…)"

    companion object {
        fun generate(): DeviceKeyPair {
            val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
            return DeviceKeyPair(pair.private as ECPrivateKey, P256.raw(pair.public as ECPublicKey))
        }

        /** From the 32-byte scalar and the public point it belongs to. */
        fun fromScalar(
            scalar: ByteArray,
            publicRaw: ByteArray,
        ): DeviceKeyPair {
            P256.publicKey(publicRaw) // validates the point
            return DeviceKeyPair(P256.privateKey(scalar), publicRaw.copyOf())
        }
    }
}

/** A vault key, held in memory so this device can wrap it to others. */
class VaultKey(
    raw: ByteArray,
) {
    val raw: ByteArray = raw.copyOf()
    val keyId: String = Bytes.hex(Bytes.sha256(raw))

    override fun equals(other: Any?): Boolean = other is VaultKey && other.keyId == keyId

    override fun hashCode(): Int = keyId.hashCode()

    override fun toString(): String = "VaultKey(${keyId.take(8)}…)"

    companion object {
        fun generate(): VaultKey = VaultKey(Bytes.random(32))
    }
}

/** Every key this device can open a vault's envelopes with. Thread-safe. */
class Keyring {
    private val keys = LinkedHashMap<String, VaultKey>()

    @Synchronized fun add(key: VaultKey) {
        keys[key.keyId] = key
    }

    @Synchronized fun get(keyId: String): VaultKey? = keys[keyId]

    @Synchronized fun has(keyId: String): Boolean = keys.containsKey(keyId)

    @get:Synchronized val size: Int get() = keys.size

    @get:Synchronized val ids: List<String> get() = keys.keys.toList()
}

/** Why an envelope did not open. */
class SealException(
    val reason: Reason,
) : Exception(reason.name) {
    enum class Reason { NOT_ENCRYPTED, KEY_NOT_HELD, FAILED_TO_AUTHENTICATE }
}

object PassCrypto {
    private val WRAP_INFO = "mero-pass/key-wrap/v1".toByteArray(Charsets.UTF_8)
    private const val FIELD_PREFIX = "mp1"
    private const val TAG_BITS = 128

    /** `hex(SHA-256(raw public key))`: the id a device is registered under. */
    fun fingerprint(publicRaw: ByteArray): String = Bytes.hex(Bytes.sha256(publicRaw))

    // ── AES-GCM and HKDF ──────────────────────────────────────────────────────────────────────

    internal fun gcmSeal(
        key: ByteArray,
        iv: ByteArray,
        plain: ByteArray,
        aad: ByteArray? = null,
    ): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        if (aad != null) cipher.updateAAD(aad)
        return cipher.doFinal(plain)
    }

    /** Throws on a failed authentication. */
    internal fun gcmOpen(
        key: ByteArray,
        iv: ByteArray,
        sealed: ByteArray,
        aad: ByteArray? = null,
    ): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        if (aad != null) cipher.updateAAD(aad)
        return cipher.doFinal(sealed)
    }

    private fun hmac(
        key: ByteArray,
        data: ByteArray,
    ): ByteArray = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data)

    /** HKDF-SHA256 (RFC 5869) to 32 bytes: one extract, one expand block. */
    internal fun hkdf32(
        ikm: ByteArray,
        salt: ByteArray,
        info: ByteArray,
    ): ByteArray {
        val prk = hmac(if (salt.isEmpty()) ByteArray(32) else salt, ikm)
        return hmac(prk, info + byteArrayOf(1))
    }

    private fun kek(
        privateKey: ECPrivateKey,
        peer: ByteArray,
        salt: ByteArray,
    ): ByteArray {
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(privateKey)
        agreement.doPhase(P256.publicKey(peer), true)
        val shared = agreement.generateSecret()
        return try {
            hkdf32(shared, salt, WRAP_INFO)
        } finally {
            shared.fill(0)
        }
    }

    // ── Key wrap ──────────────────────────────────────────────────────────────────────────────

    /** Seal [key] to one device public key. [ephemeral] and [iv] are for the test vectors only. */
    fun wrapVaultKey(
        key: VaultKey,
        recipientPublicRaw: ByteArray,
        ephemeral: DeviceKeyPair? = null,
        iv: ByteArray? = null,
    ): String {
        val eph = ephemeral ?: DeviceKeyPair.generate()
        val epk = eph.publicRaw
        val kek = kek(eph.privateKey, recipientPublicRaw, epk + recipientPublicRaw)
        val nonce = iv ?: Bytes.random(12)
        val ct = gcmSeal(kek, nonce, key.raw, key.keyId.toByteArray(Charsets.UTF_8))
        kek.fill(0)
        // Written by hand, in `JSON.stringify`'s key order (base64 needs no escaping), so a wrap
        // is the same text the web would have written.
        return "{\"v\":1,\"epk\":\"${Bytes.b64(epk)}\",\"iv\":\"${Bytes.b64(nonce)}\",\"ct\":\"${Bytes.b64(ct)}\"}"
    }

    /**
     * Open a wrap addressed to this device. `null`, never a throw, for a wrap that does not open
     * or whose key does not hash to [keyId]: a member can write garbage into their own wrap slot.
     */
    fun unwrapVaultKey(
        envelope: String,
        keyId: String,
        device: DeviceKeyPair,
    ): VaultKey? =
        try {
            val obj = Json.parseToJsonElement(envelope) as JsonObject
            val v = obj["v"] as JsonPrimitive
            if (v.isString || v.content == "true" || v.content == "false" || v.doubleOrNull != 1.0) {
                null
            } else {
                val epk = Bytes.fromB64((obj["epk"] as JsonPrimitive).also { require(it.isString) }.content)
                val iv = Bytes.fromB64((obj["iv"] as JsonPrimitive).also { require(it.isString) }.content)
                val ct = Bytes.fromB64((obj["ct"] as JsonPrimitive).also { require(it.isString) }.content)
                val kek = kek(device.privateKey, epk, epk + device.publicRaw)
                val raw = gcmOpen(kek, iv, ct, keyId.toByteArray(Charsets.UTF_8))
                kek.fill(0)
                val key = VaultKey(raw)
                raw.fill(0)
                if (key.keyId == keyId) key else null
            }
        } catch (e: Exception) {
            null
        }

    // ── Fields ────────────────────────────────────────────────────────────────────────────────

    private fun aad(
        secretId: String,
        field: String,
    ): ByteArray = "$secretId\u0000$field".toByteArray(Charsets.UTF_8)

    /** `mp1.<keyId>.<iv>.<ciphertext>`; an empty value seals to empty. */
    fun sealField(
        key: VaultKey,
        secretId: String,
        field: String,
        plaintext: String,
        iv: ByteArray? = null,
    ): String {
        if (plaintext.isEmpty()) return ""
        val nonce = iv ?: Bytes.random(12)
        val ct = gcmSeal(key.raw, nonce, plaintext.toByteArray(Charsets.UTF_8), aad(secretId, field))
        return listOf(FIELD_PREFIX, key.keyId, Bytes.b64(nonce), Bytes.b64(ct)).joinToString(".")
    }

    /** Which key sealed an envelope, or `null` for an empty or foreign value. */
    fun keyIdOf(envelope: String): String? {
        val parts = envelope.split(".")
        return if (parts.size == 4 && parts[0] == FIELD_PREFIX) parts[1] else null
    }

    /** Open an envelope; empty opens to empty. Throws [SealException]. */
    fun openField(
        keyring: Keyring,
        secretId: String,
        field: String,
        envelope: String,
    ): String {
        if (envelope.isEmpty()) return ""
        val parts = envelope.split(".")
        if (parts.size != 4 || parts[0] != FIELD_PREFIX) throw SealException(SealException.Reason.NOT_ENCRYPTED)
        val key = keyring.get(parts[1]) ?: throw SealException(SealException.Reason.KEY_NOT_HELD)
        return try {
            String(gcmOpen(key.raw, Bytes.fromB64(parts[2]), Bytes.fromB64(parts[3]), aad(secretId, field)), Charsets.UTF_8)
        } catch (e: Exception) {
            throw SealException(SealException.Reason.FAILED_TO_AUTHENTICATE)
        }
    }

    /** A fresh secret id, in the shape the contract requires. */
    fun newSecretId(): String = "secret_${Bytes.hex(Bytes.random(16))}"

    /** The short code shown on the device asking to be let in and on the one approving it. */
    fun confirmationCode(fingerprint: String): String {
        val n = (fingerprint.take(8).toLongOrNull(16) ?: 0L) % 1_000_000L
        val digits = n.toString().padStart(6, '0')
        return "${digits.take(3)} ${digits.takeLast(3)}"
    }
}
