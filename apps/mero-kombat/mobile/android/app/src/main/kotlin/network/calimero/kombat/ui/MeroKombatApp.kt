package network.calimero.kombat.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.calimero.mero.CalimeroClient
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentStarted
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.flow.MutableStateFlow
import network.calimero.kombat.app.ApprovalsModel
import network.calimero.kombat.app.KombatAppViewModel
import network.calimero.kombat.app.Route

/**
 * Restoring → a splash. Signed out → sign-in: a Calimero Cloud cluster or a development node, then a
 * passkey (practice is open without an account). Signed in → the arenas, with what waits for the
 * account's approval, and the arena opened. (iOS `RootView`.)
 */
@Composable
fun MeroKombatApp(
    vm: KombatAppViewModel,
    onSignIn: () -> Unit,
    onSignUp: (String) -> Unit,
    onShare: (String) -> Unit,
    consent: suspend (MeroAppSession, ConsentRequest, suspend (ConsentStarted) -> Boolean) -> ConsentStarted,
) {
    KombatTheme {
        val session by vm.session.collectAsState()
        val cluster by vm.cluster.collectAsState()
        val busy by vm.busy.collectAsState()
        val error by vm.error.collectAsState()
        val restored by vm.restored.collectAsState()
        val pending by vm.pendingLink.collectAsState()
        val joining by vm.joining.collectAsState()
        val route by vm.route.collectAsState()
        val current = session
        val backend by (current?.backend ?: remember { MutableStateFlow(null) }).collectAsState()
        val revision by (current?.revision ?: remember { MutableStateFlow(0) }).collectAsState()
        val approvals =
            remember(current, backend) {
                current?.takeIf { backend != null }?.let { s ->
                    ApprovalsModel(
                        load = { org -> s.client.pendingApprovals(org) },
                        consent = { build, confirm ->
                            val started = consent(s, build(s.callbackUrl)) { confirm(it.code) }
                            s.consentResult.value?.takeIf { it.requestId == started.requestId }
                                ?: runCatching { s.client.fetchConsentResult(started.requestId) }.getOrNull()
                        },
                    )
                }
            }

        when (val open = route) {
            is Route.Practice -> {
                BackHandler { vm.open(null) }
                PracticeScreen(store = vm.playerStore, onBack = { vm.open(null) })
            }
            is Route.Arena -> {
                BackHandler { vm.open(null) }
                val signedIn = backend
                if (signedIn == null) {
                    Splash("Connecting to your cluster…")
                } else {
                    key(open.ref, revision) {
                        ArenaScreen(
                            backend = signedIn,
                            ref = open.ref,
                            store = vm.playerStore,
                            onBack = { vm.open(null) },
                            onShare = onShare,
                        )
                    }
                }
            }
            null ->
                when {
                    !restored -> Splash("Restoring your session…")
                    backend == null ->
                        SignInScreen(
                            cluster = cluster,
                            busy = busy,
                            error = error,
                            invited = pending != null,
                            onChoose = vm::choose,
                            onSignIn = onSignIn,
                            onSignUp = onSignUp,
                            onCancel = vm::cancelSignIn,
                            onDismissError = vm::dismissError,
                            onPractice = { vm.open(Route.Practice) },
                        )
                    else ->
                        key(revision) {
                            LobbyScreen(
                                backend = backend!!,
                                applicationId = current?.applicationId,
                                account = current?.account.orEmpty(),
                                onOpen = { vm.open(Route.Arena(it)) },
                                onPractice = { vm.open(Route.Practice) },
                                onJoin = vm::ask,
                                onShare = onShare,
                                onSignOut = vm::signOut,
                                approvals = approvals,
                            )
                        }
                }
        }

        joining?.let { invitation ->
            JoinSheet(invitation = invitation, onJoin = { vm.join(invitation) }, onDismiss = vm::dismissJoin)
        }
    }
}

@Composable
fun Splash(
    text: String,
    footer: @Composable () -> Unit = {},
) {
    Box(Modifier.fillMaxSize().background(KombatColors.Ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(56.dp)
            CircularProgressIndicator(color = KombatColors.Ink, strokeWidth = 2.dp)
            Text(text, style = Type.body(14, color = KombatColors.Muted))
            footer()
        }
    }
}

/** What became of consent request [requestId] (`consent.pageResult`), as the session's [ConsentResult]. */
private suspend fun CalimeroClient.fetchConsentResult(requestId: String): ConsentResult =
    consent.pageResult(request = requestId).let { ConsentResult(it.requestId, it.kind.value, it.status.value, it.decidedAt) }
