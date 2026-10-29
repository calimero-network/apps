package network.calimero.blocks.ui

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import network.calimero.blocks.app.BlocksAppViewModel

/** Restoring → a splash. Signed out → sign-in. Signed in → the worlds, settings, and the game over them. (iOS `RootView`.) */
@Composable
fun MeroBlocksApp(
    vm: BlocksAppViewModel,
    onSignIn: () -> Unit,
    onShare: (String) -> Unit,
) {
    BlocksTheme {
        val session = vm.session
        val restored by vm.restored.collectAsState()
        val restoring by session.isRestoring.collectAsState()
        val auth by session.client.state.collectAsState()
        val backend by session.backend.collectAsState()
        val revision by session.revision.collectAsState()
        val pending by session.pendingInvitation.collectAsState()
        val joining by vm.joining.collectAsState()
        val playing by vm.playing.collectAsState()
        var showingSettings by remember { mutableStateOf(false) }

        when {
            !restored || restoring -> Splash("Restoring your session…")
            !auth.isDelegated -> SignInScreen(auth = auth, invited = pending != null, onSignIn = onSignIn, onCancel = vm::cancelSignIn)
            backend == null ->
                Splash("Connecting to your relay…") {
                    SecondaryButton(onClick = vm::signOut, fullWidth = false) { ButtonLabel("Sign out") }
                }
            else -> {
                val current = backend!!
                key(revision) {
                    val world = playing
                    when {
                        world != null -> {
                            BackHandler { vm.play(null) }
                            GameScreen(
                                backend = current,
                                world = world,
                                myId = vm.myId,
                                settings = vm.settings,
                                scope = vm.viewModelScope,
                                onShare = onShare,
                                onExit = { vm.play(null) },
                            )
                        }
                        showingSettings -> {
                            BackHandler { showingSettings = false }
                            SettingsScreen(
                                settings = vm.settings,
                                account = auth.account.orEmpty(),
                                onSignOut = {
                                    showingSettings = false
                                    vm.signOut()
                                },
                                onBack = { showingSettings = false },
                            )
                        }
                        else ->
                            WorldsScreen(
                                backend = current,
                                applicationId = session.applicationId,
                                onOpen = vm::play,
                                onJoin = vm::ask,
                                onShare = onShare,
                                onSettings = { showingSettings = true },
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
    Box(Modifier.fillMaxSize().background(BlocksColors.Ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(56.dp)
            CircularProgressIndicator(color = BlocksColors.Ink, strokeWidth = 2.dp)
            Text(text, style = Type.body(14, color = BlocksColors.Muted))
            footer()
        }
    }
}
