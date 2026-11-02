package network.calimero.standup.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import kotlinx.coroutines.flow.MutableStateFlow
import network.calimero.standup.app.StandupViewModel
import network.calimero.standup.app.TeamModel
import network.calimero.standup.app.TeamsModel
import network.calimero.standup.core.StandupInvitation

/** What the screens need from the activity. */
class Platform(
    val share: (title: String, text: String) -> Unit,
    val copy: (label: String, text: String) -> Unit,
)

/** Signed out -> sign in; signed in -> the team list, or the open team. */
@Composable
fun StandupApp(
    vm: StandupViewModel,
    platform: Platform,
) {
    StandupTheme {
        val session by vm.session.collectAsState()
        val backend by vm.backend.collectAsState()
        val revision by (session?.revision ?: remember { MutableStateFlow(0) }).collectAsState()
        val restored by vm.restored.collectAsState()
        val openTeam by vm.openTeam.collectAsState()
        Box(Modifier.fillMaxSize().background(Palette.background)) {
            val current = backend
            if (current == null) {
                SignInScreen(vm, restoring = !restored)
            } else {
                val teams = remember(current, revision) { TeamsModel(current, StandupInvitation.PACKAGE_NAME) }
                val open = openTeam
                if (open == null) {
                    TeamsScreen(vm, teams)
                } else {
                    val team = remember(current, open.contextId) { TeamModel(open, current) }
                    TeamScreen(vm, team, platform)
                }
            }
        }
    }
}
