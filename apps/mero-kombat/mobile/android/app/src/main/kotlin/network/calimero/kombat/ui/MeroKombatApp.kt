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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import network.calimero.kombat.app.KombatAppViewModel
import network.calimero.kombat.app.Route

/**
 * Restoring → a splash. Signed out → sign-in (practice is open without an account). Signed in → the
 * arenas, and the arena opened. (iOS `RootView`.)
 */
@Composable
fun MeroKombatApp(
    vm: KombatAppViewModel,
    onSignIn: () -> Unit,
    onShare: (String) -> Unit,
) {
    KombatTheme {
        val session = vm.session
        val restored by vm.restored.collectAsState()
        val restoring by session.isRestoring.collectAsState()
        val auth by session.client.state.collectAsState()
        val backend by session.backend.collectAsState()
        val revision by session.revision.collectAsState()
        val pending by session.pendingInvitation.collectAsState()
        val joining by vm.joining.collectAsState()
        val route by vm.route.collectAsState()

        when (val open = route) {
            is Route.Practice -> {
                BackHandler { vm.open(null) }
                PracticeScreen(store = vm.store, onBack = { vm.open(null) })
            }
            is Route.Arena -> {
                BackHandler { vm.open(null) }
                val current = backend
                if (current == null) {
                    Splash("Connecting to your relay…")
                } else {
                    key(open.ref, revision) {
                        ArenaScreen(
                            backend = current,
                            ref = open.ref,
                            store = vm.store,
                            relayPresence = session.client.presence,
                            onBack = { vm.open(null) },
                            onShare = onShare,
                        )
                    }
                }
            }
            null ->
                when {
                    !restored || restoring -> Splash("Restoring your session…")
                    !auth.isDelegated ->
                        SignInScreen(
                            auth = auth,
                            invited = pending != null,
                            onSignIn = onSignIn,
                            onCancel = vm::cancelSignIn,
                            onPractice = { vm.open(Route.Practice) },
                        )
                    backend == null ->
                        Splash("Connecting to your relay…") {
                            SecondaryButton(onClick = vm::signOut, fullWidth = false) { ButtonLabel("Sign out") }
                        }
                    else ->
                        key(revision) {
                            LobbyScreen(
                                backend = backend!!,
                                applicationId = session.applicationId,
                                account = auth.account.orEmpty(),
                                onOpen = { vm.open(Route.Arena(it)) },
                                onPractice = { vm.open(Route.Practice) },
                                onJoin = vm::ask,
                                onShare = onShare,
                                onSignOut = vm::signOut,
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
