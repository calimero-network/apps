package network.calimero.stream.app

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
import network.calimero.stream.BuildConfig
import network.calimero.stream.core.MediaChannel
import network.calimero.stream.core.RelayMediaChannel
import network.calimero.stream.core.StreamInvitation

/** A room being called in. */
data class CallTarget(
    val stream: StreamSummary,
    val room: RoomSummary,
    val contextId: String,
)

/**
 * The app's session and where the person is: the stream list, a stream's rooms, the call. The
 * session is the SDK's [MeroAppSession]: Cloud sign-in, the account's relay, deep links and
 * invitations, delegated end to end.
 */
class StreamViewModel(
    app: Application,
) : AndroidViewModel(app) {
    val session: MeroAppSession =
        MeroAppSession.create(
            app,
            packageName = StreamInvitation.PACKAGE_NAME,
            callbackUrl = BuildConfig.ENROL_CALLBACK_URL,
            config = config(),
            walletUrl = BuildConfig.WALLET_URL.ifEmpty { Enrolment.DEFAULT_WALLET_URL },
            scope = viewModelScope,
        )

    private val prefs = app.getSharedPreferences("mero-stream", Context.MODE_PRIVATE)

    private val _openStream = MutableStateFlow<StreamSummary?>(null)

    /** The stream whose rooms are on screen, or null for the stream list. */
    val openStream: StateFlow<StreamSummary?> = _openStream.asStateFlow()

    private val _call = MutableStateFlow<CallTarget?>(null)

    /** The call on screen. */
    val call: StateFlow<CallTarget?> = _call.asStateFlow()

    /** A room an invitation link asked to open, entered once its stream's rooms load. */
    val autoEnter = MutableStateFlow<RoomSummary?>(null)

    private val _displayName = MutableStateFlow(prefs.getString("displayName", "").orEmpty())

    /** Your name in calls, kept on this device. */
    val displayName: StateFlow<String> = _displayName.asStateFlow()

    init {
        viewModelScope.launch { session.restore() }
    }

    fun signIn(context: Context) = session.signIn(context)

    fun signOut() {
        _call.value = null
        _openStream.value = null
        viewModelScope.launch { session.signOut() }
    }

    fun handleLink(url: String) {
        viewModelScope.launch { session.handle(url) }
    }

    fun openStream(stream: StreamSummary?) {
        _openStream.value = stream
    }

    fun openCall(target: CallTarget?) {
        _call.value = target
    }

    fun land(landing: InvitationLanding) {
        when (landing) {
            is InvitationLanding.Stream -> _openStream.value = landing.stream
            is InvitationLanding.Room -> {
                autoEnter.value = landing.room
                _openStream.value = landing.stream
            }
        }
    }

    fun setDisplayName(name: String) {
        _displayName.value = name
        prefs.edit().putString("displayName", name).apply()
    }

    /** An invitation was redeemed: a relayless session now has the admitting relay. */
    suspend fun didJoin() = session.didJoinNamespace()

    /** The call's media channel: the account's presence through its relay. */
    fun mediaChannel(): MediaChannel? {
        val presence = session.client.presence ?: return null
        return RelayMediaChannel(
            presence,
            session.client.relay
                ?.authorSigner
                ?.publicKey,
        )
    }

    private fun config(): MeroAppConfig {
        var config = MeroAppConfig()
        if (BuildConfig.CLOUD_BASE_URL.isNotEmpty()) config = config.copy(cloudBaseUrl = BuildConfig.CLOUD_BASE_URL)
        if (BuildConfig.REGISTRY_URL.isNotEmpty()) config = config.copy(registryUrl = BuildConfig.REGISTRY_URL)
        return config
    }
}
