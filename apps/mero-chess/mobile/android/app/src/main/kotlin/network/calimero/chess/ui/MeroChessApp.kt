package network.calimero.chess.ui

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
import network.calimero.chess.app.ChessAppViewModel

/** Restoring → a splash. Signed out → sign-in. Signed in → the tables, and the table opened. (iOS `RootView`.) */
@Composable
fun MeroChessApp(
    vm: ChessAppViewModel,
    onSignIn: () -> Unit,
    onShare: (String) -> Unit,
) {
    ChessTheme {
        val session = vm.session
        val restored by vm.restored.collectAsState()
        val restoring by session.isRestoring.collectAsState()
        val auth by session.client.state.collectAsState()
        val backend by session.backend.collectAsState()
        val revision by session.revision.collectAsState()
        val pending by session.pendingInvitation.collectAsState()
        val joining by vm.joining.collectAsState()
        val open by vm.openTable.collectAsState()

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
                    val table = open
                    if (table != null) {
                        BackHandler { vm.open(null) }
                        TableScreen(backend = current, ref = table, names = vm.names, onBack = { vm.open(null) }, onShare = onShare)
                    } else {
                        LobbyScreen(
                            backend = current,
                            applicationId = session.applicationId,
                            account = auth.account.orEmpty(),
                            onOpen = vm::open,
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
    Box(Modifier.fillMaxSize().background(ChessColors.Ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(56.dp)
            CircularProgressIndicator(color = ChessColors.Ink, strokeWidth = 2.dp)
            Text(text, style = Type.body(14, color = ChessColors.Muted))
            footer()
        }
    }
}
