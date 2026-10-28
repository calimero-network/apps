package network.calimero.pass.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * The native crypto against the web's, through `mobile/test-vectors/vectors.json` (written by
 * running the web's own code, see generate.mjs). iOS `CryptoVectorTests` asserts the same file,
 * case for case.
 */
class CryptoVectorTest {
    private val v: JsonObject = vectors

    private fun JsonElement.str(key: String): String = jsonObject[key]!!.jsonPrimitive.content

    private fun JsonElement.strOrNull(key: String): String? = jsonObject[key]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content

    private fun list(key: String) = v[key]!!.jsonArray

    private fun deviceVector(name: String) = v["devices"]!!.jsonObject[name]!!

    private fun device(name: String): DeviceKeyPair =
        DeviceKeyPair.fromScalar(Bytes.fromHex(deviceVector(name).str("d")), Bytes.fromB64(deviceVector(name).str("publicRaw")))

    @Test
    fun `device public keys, fingerprints and codes`() {
        for ((name, d) in v["devices"]!!.jsonObject) {
            val pair = device(name)
            assertEquals(name, d.str("fingerprint"), PassCrypto.fingerprint(pair.publicRaw))
            assertEquals(name, d.str("confirmationCode"), PassCrypto.confirmationCode(d.str("fingerprint")))
            // The scalar round-trips through the platform key.
            assertEquals(d.str("d"), Bytes.hex(pair.scalar))
        }
    }

    @Test
    fun `vault key ids`() {
        for (k in list("vaultKeys")) assertEquals(k.str("keyId"), VaultKey(Bytes.fromB64(k.str("raw"))).keyId)
    }

    @Test
    fun `wrap is byte for byte the web's`() {
        for (w in list("wraps")) {
            val key = VaultKey(Bytes.fromB64(w.str("keyRaw")))
            val eph = DeviceKeyPair.fromScalar(Bytes.fromHex(w.str("ephemeralD")), Bytes.fromB64(w.str("ephemeralPublic")))
            val envelope = PassCrypto.wrapVaultKey(key, device(w.str("recipient")).publicRaw, eph, Bytes.fromB64(w.str("iv")))
            assertEquals(w.str("envelope"), envelope)
        }
    }

    @Test
    fun `web wraps open natively`() {
        for (w in list("wraps")) {
            val opened = PassCrypto.unwrapVaultKey(w.str("envelope"), w.str("keyId"), device(w.str("recipient")))
            assertEquals(w.str("keyId"), opened?.keyId)
            assertArrayEquals(Bytes.fromB64(w.str("keyRaw")), opened?.raw)
        }
    }

    @Test
    fun `wraps that must not open`() {
        for (r in list("wrapRejects")) {
            assertNull(r.str("why"), PassCrypto.unwrapVaultKey(r.str("envelope"), r.str("keyId"), device(r.str("recipient"))))
        }
    }

    @Test
    fun `a fresh wrap round-trips`() {
        val key = VaultKey.generate()
        val bob = device("bob")
        val envelope = PassCrypto.wrapVaultKey(key, bob.publicRaw)
        assertEquals(key, PassCrypto.unwrapVaultKey(envelope, key.keyId, bob))
        assertNull(PassCrypto.unwrapVaultKey(envelope, key.keyId, device("alice")))
    }

    @Test
    fun `field seal is byte for byte the web's`() {
        for (f in list("fields")) {
            val key = VaultKey(Bytes.fromB64(f.str("keyRaw")))
            assertEquals(f.str("keyId"), key.keyId)
            val envelope = PassCrypto.sealField(key, f.str("secretId"), f.str("field"), f.str("plaintext"), Bytes.fromB64(f.str("iv")))
            assertEquals(f.str("field"), f.str("envelope"), envelope)
            assertEquals(f.str("keyId"), PassCrypto.keyIdOf(envelope))
        }
    }

    private fun ring(): Keyring = Keyring().also { r -> list("vaultKeys").forEach { r.add(VaultKey(Bytes.fromB64(it.str("raw")))) } }

    @Test
    fun `web fields open natively`() {
        val ring = ring()
        for (f in list("fields")) {
            assertEquals(f.str("plaintext"), PassCrypto.openField(ring, f.str("secretId"), f.str("field"), f.str("envelope")))
        }
        assertEquals("", PassCrypto.openField(ring, "x", "y", ""))
        assertEquals("", PassCrypto.sealField(VaultKey.generate(), "x", "y", ""))
    }

    @Test
    fun `fields that must not open`() {
        val ring = ring()
        for (r in list("fieldRejects")) {
            try {
                PassCrypto.openField(ring, r.str("secretId"), r.str("field"), r.str("envelope"))
                fail(r.str("why"))
            } catch (e: SealException) {
                // expected
            }
        }
    }

    @Test
    fun `recovery codes`() {
        for (r in list("recoveryCodes")) {
            val bytes = Bytes.fromHex(r.str("d")) + Bytes.fromHex(r.str("fingerprint").take(6))
            assertEquals(r.str("code"), RecoveryCode.encode(bytes))
            assertArrayEquals(bytes, RecoveryCode.decode(r.str("code")))
            val publicRaw = deviceVector(r.str("device")).str("publicRaw")
            val candidate = DeviceRecord(r.str("fingerprint"), publicRaw, RECOVERY_LABEL, "recovery", "a")
            val pair = RecoveryCode.pair(r.str("code"), listOf(candidate))
            assertEquals(r.str("fingerprint"), pair?.second)
            assertEquals(publicRaw, pair?.first?.publicRaw?.let(Bytes::b64))
        }
        assertArrayEquals(
            RecoveryCode.decode(list("recoveryCodes")[0].str("code")),
            RecoveryCode.decode(v["recoverySloppyInput"]!!.jsonPrimitive.content),
        )
        try {
            RecoveryCode.decode("ABCD")
            fail("short code decoded")
        } catch (e: RecoveryCode.Failure) {
            // expected
        }
        // A code only names the recovery device whose fingerprint carries its prefix. (Unlike iOS,
        // a matching prefix with another public key is taken: see RecoveryCode.pair.)
        val other = DeviceRecord("ffffff" + "0".repeat(58), deviceVector("bob").str("publicRaw"), "", "recovery", "a")
        assertNull(RecoveryCode.pair(list("recoveryCodes")[0].str("code"), listOf(other)))
    }

    @Test
    fun `a fresh recovery key round-trips`() {
        val (code, key) = RecoveryCode.create()
        val candidate = DeviceRecord(key.fingerprint, Bytes.b64(key.publicRaw), "", "recovery", "a")
        assertEquals(key.fingerprint, RecoveryCode.pair(code, listOf(candidate))?.second)
    }

    private fun payload(e: JsonElement): ShareLink.Payload = Json.decodeFromJsonElement(ShareLink.Payload.serializer(), e)

    @Test
    fun `web share links open natively`() {
        for (s in list("shareLinks")) {
            val pass = s.strOrNull("passphrase")
            val opened = ShareLink.openFragment(s.str("fragment"), pass, s.jsonObject["now"]!!.jsonPrimitive.long)
            assertEquals(payload(s.jsonObject["secret"]!!), opened)
            assertEquals(pass != null, ShareLink.needsPassphrase(s.str("fragment")))
        }
        for (r in list("shareRejects")) {
            try {
                ShareLink.openFragment(r.str("fragment"), r.strOrNull("passphrase"), r.jsonObject["now"]!!.jsonPrimitive.long)
                fail(r.str("why"))
            } catch (e: ShareLink.Failure) {
                assertEquals(r.str("why"), r.str("error"), e.message)
            }
        }
    }

    @Test
    fun `native share links use the web's format`() {
        val key = list("shareLinks")[0]
        val now = key.jsonObject["now"]!!.jsonPrimitive.long
        val secret = payload(key.jsonObject["secret"]!!)
        val fragment = ShareLink.createFragment(secret, iv = Bytes.fromB64(key.str("iv")), key = Bytes.fromB64(key.str("key")))
        assertTrue(fragment.startsWith(key.str("fragment").takeWhile { it != 'd' }))
        assertEquals(secret, ShareLink.openFragment(fragment, now = now))
        val pass = list("shareLinks")[1]
        val withPass =
            ShareLink.createFragment(
                secret,
                pass.str("passphrase"),
                iv = Bytes.fromB64(pass.str("iv")),
                salt = Bytes.fromB64(pass.str("salt")),
            )
        assertTrue(withPass.startsWith(pass.str("fragment").takeWhile { it != 'd' }))
        assertEquals(secret, ShareLink.openFragment(withPass, pass.str("passphrase"), now))
        assertTrue(ShareLink.url("v=1").startsWith("https://"))
    }

    @Test
    fun totp() {
        for (t in list("totp")) {
            val params = Totp.parse(t.str("input")) ?: return fail("did not parse ${t.str("input")}")
            assertEquals(t.jsonObject["digits"]!!.jsonPrimitive.int, params.digits)
            assertEquals(t.jsonObject["period"]!!.jsonPrimitive.int, params.period)
            assertEquals(t.str("algorithm"), params.algorithm.label)
            assertEquals(t.strOrNull("issuer"), params.issuer)
            assertEquals(t.strOrNull("account"), params.account)
            val at = t.jsonObject["atMs"]!!.jsonPrimitive.long
            assertEquals(t.str("code"), Totp.code(params, at))
            assertEquals(t.jsonObject["secondsRemaining"]!!.jsonPrimitive.int, Totp.secondsRemaining(params.period, at))
        }
        for (bad in list("totpInvalid")) assertNull(bad.jsonPrimitive.content, Totp.parse(bad.jsonPrimitive.content))
    }

    @Test
    fun strength() {
        for (s in list("strength")) {
            assertEquals(s.str("password"), s.jsonObject["score"]!!.jsonPrimitive.int, PasswordTools.strength(s.str("password")))
        }
    }

    @Test
    fun `generator and secret ids`() {
        val pw = PasswordTools.generate(32)
        assertEquals(32, pw.length)
        assertNotEquals(pw, PasswordTools.generate(32))
        assertTrue(Regex("^secret_[0-9a-f]{32}$").matches(PassCrypto.newSecretId()))
        assertEquals("000 000", PassCrypto.confirmationCode("0".repeat(64)))
    }

    @Test
    fun `keys never describe themselves`() {
        val key = VaultKey.generate()
        assertFalse(key.toString().contains(Bytes.b64(key.raw)))
        assertEquals("DeviceKeyPair(…)", DeviceKeyPair.generate().toString())
        assertNotNull(key.keyId)
    }

    companion object {
        /** Walks up from the test's working directory to `mobile/test-vectors/vectors.json`. */
        val vectors: JsonObject by lazy {
            var dir: File? = File(System.getProperty("user.dir")).absoluteFile
            while (dir != null) {
                val candidate = File(dir, "test-vectors/vectors.json")
                if (candidate.isFile) return@lazy Json.parseToJsonElement(candidate.readText()).jsonObject
                dir = dir.parentFile
            }
            error("mobile/test-vectors/vectors.json not found above ${System.getProperty("user.dir")}")
        }
    }
}
