package network.calimero.pass.core

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The device key at rest: the private scalar and its public point (Java cannot derive one from the other). */
class StoredDeviceKey(
    val scalar: ByteArray,
    val publicRaw: ByteArray,
) {
    override fun toString(): String = "StoredDeviceKey(…)"
}

/** Where this phone's device key lives at rest. The Keystore in the app; memory in tests. (Swift `DeviceKeyStore`.) */
interface DeviceKeyStore {
    fun load(): StoredDeviceKey?

    fun save(key: StoredDeviceKey)

    fun clear()
}

/**
 * The device key sealed under an AES-256-GCM key that lives in the Android Keystore (hardware
 * backed where the phone has it, never exportable). SharedPreferences holds only the sealed
 * bytes, and the app excludes them from backup (`allowBackup="false"`), so they never leave this
 * phone. The iOS twin keeps the scalar in the Keychain, this device only.
 */
class KeystoreDeviceKeyStore(
    context: Context,
    private val alias: String = "network.calimero.pass.device-seal",
) : DeviceKeyStore {
    private val prefs = context.getSharedPreferences("pass.device", Context.MODE_PRIVATE)

    private fun sealingKey(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec
                .Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_BITS)
                .build(),
        )
        return generator.generateKey()
    }

    override fun load(): StoredDeviceKey? {
        val iv = prefs.getString(IV, null) ?: return null
        val sealed = prefs.getString(SEALED, null) ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, sealingKey(), GCMParameterSpec(TAG_BITS, Bytes.fromB64(iv)))
        val plain = cipher.doFinal(Bytes.fromB64(sealed))
        try {
            if (plain.size != SCALAR + PUBLIC) throw PassCryptoException("The stored device key is damaged.")
            return StoredDeviceKey(plain.copyOfRange(0, SCALAR), plain.copyOfRange(SCALAR, SCALAR + PUBLIC))
        } finally {
            plain.fill(0)
        }
    }

    override fun save(key: StoredDeviceKey) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, sealingKey())
        val plain = key.scalar + key.publicRaw
        try {
            val sealed = cipher.doFinal(plain)
            prefs
                .edit()
                .putString(IV, Bytes.b64(cipher.iv))
                .putString(SEALED, Bytes.b64(sealed))
                .commit()
        } finally {
            plain.fill(0)
        }
    }

    override fun clear() {
        prefs.edit().clear().commit()
        runCatching { KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(alias) }
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val IV = "iv"
        const val SEALED = "sealed"
        const val KEY_BITS = 256
        const val TAG_BITS = 128
        const val SCALAR = 32
        const val PUBLIC = 65
    }
}

/** [DeviceKeyStore] in memory, for tests and previews. */
class MemoryDeviceKeyStore(
    private var value: StoredDeviceKey? = null,
) : DeviceKeyStore {
    @Synchronized override fun load(): StoredDeviceKey? = value

    @Synchronized override fun save(key: StoredDeviceKey) {
        value = key
    }

    @Synchronized override fun clear() {
        value = null
    }
}

/**
 * This phone's device key, and whether it is unlocked in memory (the web's `DeviceKeeper`). The
 * first unlock makes the key. Locking drops it, and with it every open vault's keyring: the
 * screens are rebuilt on each unlock. (Swift `DeviceKeeper`.)
 *
 * The web seals its key under a passphrase or a passkey. A phone keeps it sealed by the Keystore
 * and asks for the fingerprint, face or screen lock (BiometricPrompt) before [unlock] is called.
 */
class DeviceKeeper(
    private val store: DeviceKeyStore,
) {
    private val _device = MutableStateFlow<DeviceKeyPair?>(null)
    val device: StateFlow<DeviceKeyPair?> = _device.asStateFlow()

    /** Moves on every unlock and lock, so screens holding a session can rebuild. */
    private val _generation = MutableStateFlow(0)
    val generation: StateFlow<Int> = _generation.asStateFlow()

    val isUnlocked: Boolean get() = _device.value != null
    val fingerprint: String? get() = _device.value?.let { PassCrypto.fingerprint(it.publicRaw) }

    /** Whether a key exists yet (a first unlock creates one). */
    val hasKey: Boolean get() = runCatching { store.load() }.getOrNull() != null

    /** Load the key into memory, creating it on first use. Call after the biometric / screen-lock check. */
    @Synchronized
    fun unlock(): DeviceKeyPair {
        _device.value?.let { return it }
        val stored = store.load()
        val pair =
            if (stored != null) {
                DeviceKeyPair.fromScalar(stored.scalar, stored.publicRaw).also { stored.scalar.fill(0) }
            } else {
                DeviceKeyPair.generate().also { store.save(StoredDeviceKey(it.scalar, it.publicRaw)) }
            }
        _device.value = pair
        _generation.value += 1
        return pair
    }

    /** Drop the key from memory. */
    @Synchronized
    fun lock() {
        if (_device.value == null) return
        _device.value = null
        _generation.value += 1
    }

    /** Forget this phone's key, for signing out with "forget this device". */
    fun reset() {
        store.clear()
        lock()
    }
}
