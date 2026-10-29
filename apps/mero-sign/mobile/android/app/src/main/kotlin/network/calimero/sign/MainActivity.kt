package network.calimero.sign

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.launch
import network.calimero.sign.core.AgreementDirectory
import network.calimero.sign.core.AgreementModel
import network.calimero.sign.core.AgreementRef
import network.calimero.sign.core.AgreementsModel
import network.calimero.sign.core.BackendSignAdmin
import network.calimero.sign.core.DocumentModel
import network.calimero.sign.core.InboxModel
import network.calimero.sign.core.InvitationModel
import network.calimero.sign.core.NameDirectory
import network.calimero.sign.core.PdfStamping
import network.calimero.sign.core.PrivateContextCache
import network.calimero.sign.core.PrivateStore
import network.calimero.sign.core.SignConstants
import network.calimero.sign.core.SignaturesModel
import network.calimero.sign.pdf.PdfBoxStamper
import network.calimero.sign.ui.SignApp

/**
 * The one activity. Links arrive here, on the launch intent or through [onNewIntent]: the
 * wallet's sign-in redirect, or an invitation
 * (`https://links.calimero.network/com.calimero.mero-sign/join?invitation=…`).
 */
class MainActivity : ComponentActivity() {
    private val vm: SignViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) consume(intent)
        setContent { SignApp(vm = vm, onSignIn = { vm.session.signIn(this) }) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consume(intent)
    }

    private fun consume(intent: Intent?) {
        val url = intent?.data?.toString() ?: return
        vm.handleLink(url)
        intent.data = null
    }
}

/** The session, the invitation being redeemed, and the stamper, for the app's life. */
class SignViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = SignConstants.PACKAGE_NAME,
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
    val stamper: PdfStamping by lazy { PdfBoxStamper(app) }
    val cache: PrivateContextCache = PrefsPrivateContextCache(app)

    init {
        viewModelScope.launch { session.restore() }
    }

    fun handleLink(url: String) =
        viewModelScope.launch {
            session.handle(url)
            session.pendingInvitation.value?.let {
                invitation.open(it)
                session.dismissPendingInvitation()
            }
        }

    /** A directory over whatever backend the session has now (for the invitation flow). */
    fun directory(): AgreementDirectory? {
        val backend = session.backend.value ?: return null
        val admin = BackendSignAdmin(backend, session.client.admin)
        return AgreementDirectory(backend, PrivateStore(backend, admin, session.applicationId, cache))
    }
}

/** Everything a signed-in screen needs, rebuilt when the session changes. (iOS `AppServices`.) */
class Services(
    val backend: MeroAppBackend,
    vm: SignViewModel,
) {
    val admin = BackendSignAdmin(backend, vm.session.client.admin)
    val store = PrivateStore(backend, admin, vm.session.applicationId, vm.cache)
    val directory = AgreementDirectory(backend, store)
    val names = NameDirectory(admin)
    val inbox = InboxModel(directory)
    val agreements = AgreementsModel(directory)
    val signatures = SignaturesModel(store)
    private val stamper = vm.stamper
    private val agreementModels = mutableMapOf<String, AgreementModel>()
    private val documentModels = mutableMapOf<String, DocumentModel>()

    fun agreement(ref: AgreementRef): AgreementModel = agreementModels.getOrPut(ref.contextId) { AgreementModel(directory, names, ref) }

    fun document(
        ref: AgreementRef,
        documentId: String,
    ): DocumentModel =
        documentModels.getOrPut("${ref.contextId}/$documentId") {
            DocumentModel(
                directory,
                names,
                ref,
                documentId,
                stamper,
                inbox.entries.value.firstOrNull { it.agreement.contextId == ref.contextId && it.document.id == documentId },
            )
        }

    fun forget(
        ref: AgreementRef,
        documentId: String,
    ) {
        documentModels.remove("${ref.contextId}/$documentId")
    }
}

/** [PrivateContextCache] in SharedPreferences. */
class PrefsPrivateContextCache(
    context: Context,
) : PrivateContextCache {
    private val prefs = context.getSharedPreferences("sign", Context.MODE_PRIVATE)

    override fun load(account: String): String? = prefs.getString("privateContext.$account", null)

    override fun save(
        contextId: String?,
        account: String,
    ) = prefs.edit().putString("privateContext.$account", contextId).apply()
}
