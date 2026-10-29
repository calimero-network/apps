package network.calimero.merraria.ui

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
import network.calimero.merraria.app.MerrariaAppViewModel

/** Restoring → a splash. Signed out → sign-in. Signed in → the worlds, and the world being played over them, full screen. (iOS `RootView`.) */
@Composable
fun MerrariaApp(
    vm: MerrariaAppViewModel,
    onSignIn: () -> Unit,
    onShare: (String) -> Unit,
) {
    MerrariaTheme {
        val session = vm.session
        val restored by vm.restored.collectAsState()
        val restoring by session.isRestoring.collectAsState()
        val auth by session.client.state.collectAsState()
        val backend by session.backend.collectAsState()
        val revision by session.revision.collectAsState()
        val pending by session.pendingInvitation.collectAsState()
        val joining by vm.joining.collectAsState()
        val playing by vm.playing.collectAsState()

        when {
            !restored || restoring -> Splash("Restoring your session…")
            !auth.isDelegated -> SignInScreen(auth = auth, invited = pending != null, onSignIn = onSignIn, onCancel = vm::cancelSignIn)
            backend == null ->
                Splash("Connecting to your relay…") {
                    SecondaryButton(onClick = vm::signOut, fullWidth = false) { ButtonLabel("Sign out") }
                }
            else -> {
                val current = backend!!
                val world = playing
                if (world != null) {
                    key(world.contextId) {
                        GameScreen(backend = current, ref = world, settings = vm.settings, onShare = onShare, onClose = { vm.play(null) })
                    }
                } else {
                    key(revision) {
                        WorldsScreen(
                            backend = current,
                            applicationId = session.applicationId,
                            account = auth.account.orEmpty(),
                            settings = vm.settings,
                            onPlay = vm::play,
                            onJoin = vm::ask,
                            onShare = onShare,
                            onSignOut = vm::signOut,
                        )
                    }
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
    Box(Modifier.fillMaxSize().background(MerrariaColors.Ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(56.dp)
            CircularProgressIndicator(color = MerrariaColors.Ink, strokeWidth = 2.dp)
            Text(text, style = Type.body(14, color = MerrariaColors.Muted))
            footer()
        }
    }
}
