package network.calimero.vote

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.launch
import network.calimero.vote.core.InvitationModel
import network.calimero.vote.core.TrusteeKey
import network.calimero.vote.core.TrusteeKeyStore
import network.calimero.vote.core.VoteConstants
import network.calimero.vote.ui.VoteApp
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The one activity. Links arrive here, on the launch intent (cold start) or through
 * [onNewIntent], and go to [VoteViewModel.handleLink]: the wallet's sign-in redirect, or an
 * invitation (`https://links.calimero.network/com.calimero.mero-vote/join?invitation=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: VoteViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent { VoteApp(vm = vm, onSignIn = { vm.session.signIn(this) }) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consume(intent)
    }

    private fun consume(intent: Intent?) {
        val url = intent?.data?.toString() ?: return
        vm.handleLink(url)
        // Handled once: a configuration change must not replay it.
        intent.data = null
    }
}

/** The session, the invitation being redeemed, and the trustee keys, for the app's life. */
class VoteViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = VoteConstants.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config =
                MeroAppConfig(
                    registryUrl = BuildConfig.REGISTRY_URL.ifBlank { null },
                    cloudBaseUrl = BuildConfig.CLOUD_BASE_URL.ifBlank { MeroAppConfig().cloudBaseUrl },
                ),
            walletUrl = BuildConfig.WALLET_URL.ifBlank { com.calimero.mero.account.Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )
    val invitation = InvitationModel()
    val keys: TrusteeKeyStore = KeystoreTrusteeKeyStore(app)

    init {
        viewModelScope.launch { session.restore() }
    }

    /** Every link the activity receives. */
    fun handleLink(url: String) =
        viewModelScope.launch {
            session.handle(url)
            session.pendingInvitation.value?.let {
                invitation.open(it)
                session.dismissPendingInvitation()
            }
        }
}

/**
 * Trustee keys sealed with an AES-GCM key that never leaves the Android Keystore; only the
 * ciphertext sits in this app's private SharedPreferences. (iOS keeps them in the Keychain.)
 */
class KeystoreTrusteeKeyStore(
    context: Context,
) : TrusteeKeyStore {
    private val prefs = context.getSharedPreferences("trustee-keys", Context.MODE_PRIVATE)

    override fun load(
        contextId: String,
        pollId: String,
        account: String,
    ): TrusteeKey? =
        runCatching {
            val sealed = prefs.getString(TrusteeKey.name(contextId, pollId, account), null) ?: return null
            val bytes = Base64.decode(sealed, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
            val text = String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
            TrusteeKey.parse(text, contextId, pollId, account)
        }.getOrNull()

    override fun save(key: TrusteeKey): Boolean =
        runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val sealed = cipher.iv + cipher.doFinal(key.json().toByteArray(Charsets.UTF_8))
            prefs
                .edit()
                .putString(TrusteeKey.name(key.contextId, key.pollId, key.account), Base64.encodeToString(sealed, Base64.NO_WRAP))
                .commit()
        }.getOrDefault(false)

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec
                .Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_BITS)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "mero-vote-trustee-keys"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
        const val KEY_BITS = 256
    }
}
