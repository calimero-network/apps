package network.calimero.crm.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.calimero.mero.account.Enrolment
import com.calimero.mero.compose.MeroAppConfig
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import network.calimero.crm.BuildConfig
import network.calimero.crm.core.CrmInvitation

/**
 * The app's session and which pipeline is open. The session is the SDK's [MeroAppSession]: Cloud
 * sign-in, the account's relay, deep links and invitations, delegated end to end.
 */
class CrmViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = CrmInvitation.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config = config(),
            walletUrl = BuildConfig.WALLET_URL.ifEmpty { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    private val prefs = app.getSharedPreferences("mero-crm", Context.MODE_PRIVATE)

    /** Device-local pipeline and workspace names (see [LocalNames]). */
    val names = LocalNames(PreferencesStore(prefs))

    private val _openPipeline = MutableStateFlow(restorePipeline())

    /** The pipeline on screen, or null for the workspace list. */
    val openPipeline: StateFlow<PipelineRef?> = _openPipeline.asStateFlow()

    init {
        viewModelScope.launch { session.restore() }
    }

    fun signIn(context: Context) = session.signIn(context)

    fun signOut() {
        open(null)
        viewModelScope.launch { session.signOut() }
    }

    fun handleLink(url: String) {
        viewModelScope.launch { session.handle(url) }
    }

    fun open(pipeline: PipelineRef?) {
        _openPipeline.value = pipeline
        prefs.edit().putString(OPEN_KEY, pipeline?.let { Json.encodeToString(PipelineRef.serializer(), it) }).apply()
    }

    /** A workspace was joined: a relayless session now has the admitting relay. */
    suspend fun didJoin() = session.didJoinNamespace()

    private fun restorePipeline(): PipelineRef? =
        prefs.getString(OPEN_KEY, null)?.let { raw ->
            runCatching { Json.decodeFromString(PipelineRef.serializer(), raw) }.getOrNull()
        }

    private fun config(): MeroAppConfig {
        var config = MeroAppConfig()
        if (BuildConfig.CLOUD_BASE_URL.isNotEmpty()) config = config.copy(cloudBaseUrl = BuildConfig.CLOUD_BASE_URL)
        if (BuildConfig.REGISTRY_URL.isNotEmpty()) config = config.copy(registryUrl = BuildConfig.REGISTRY_URL)
        return config
    }

    private companion object {
        const val OPEN_KEY = "openPipeline"
    }
}
