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
import network.calimero.chess.app.ChessConstants

/** Restoring → a splash. Signed out → sign-in. Signed in → the tables, and the table opened. (iOS `RootView`.) */
@Composable
fun MeroChessApp(
    vm: ChessAppViewModel,
    onCloud: (cluster: String, create: Boolean, name: String) -> Unit,
    onShare: (String) -> Unit,
) {
    ChessTheme {
        val restored by vm.restored.collectAsState()
        val session by vm.session.collectAsState()
        val backend by vm.backend.collectAsState()
        val revision by vm.revision.collectAsState()
        val signIn by vm.signIn.collectAsState()
        val pendingLink by vm.pendingLink.collectAsState()
        val joining by vm.joining.collectAsState()
        val open by vm.openTable.collectAsState()
        val consentReturned by vm.consentReturned.collectAsState()
        val restoring = session?.isRestoring?.collectAsState()?.value ?: false
        val sessionInvite = session?.pendingInvitation?.collectAsState()?.value

        val current = backend
        when {
            !restored || restoring -> Splash("Restoring your session…")
            current == null ->
                SignInScreen(
                    state = signIn,
                    invited = pendingLink != null || sessionInvite != null,
                    initialMode = vm.mode,
                    initialCluster = vm.lastCluster,
                    initialDevNode = vm.lastDevNode,
                    onCloud = onCloud,
                    onDevelopment = vm::signInDev,
                    onDismissError = vm::dismissSignInError,
                )
            else -> {
                key(revision) {
                    val table = open
                    if (table != null) {
                        BackHandler { vm.open(null) }
                        TableScreen(backend = current, ref = table, names = vm.names, onBack = { vm.open(null) }, onShare = onShare)
                    } else {
                        LobbyScreen(
                            backend = current,
                            applicationId = ChessConstants.PACKAGE_NAME,
                            account = current.account,
                            approvals = vm.approvals,
                            consentReturned = consentReturned,
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
        ConsentCodeSheet(vm.approvals)
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
