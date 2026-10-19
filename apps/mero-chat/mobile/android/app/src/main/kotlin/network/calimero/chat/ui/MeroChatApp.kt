package network.calimero.chat.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import network.calimero.chat.app.ChatAppViewModel
import network.calimero.chat.app.SessionStage

/** The app: sign-in until there is a session, then workspaces → channels → a channel. */
@Composable
fun MeroChatApp(
    vm: ChatAppViewModel,
    onSignIn: () -> Unit,
    onShare: (title: String, text: String) -> Unit,
) {
    MeroChatTheme {
        val stage by vm.session.collectAsStateWithLifecycle()
        when (val s = stage) {
            is SessionStage.SignedOut -> SignInScreen(busy = false, error = s.error, cancelled = s.cancelled, onSignIn = onSignIn, onCancel = {})
            SessionStage.Connecting -> SignInScreen(busy = true, error = null, cancelled = false, onSignIn = onSignIn, onCancel = vm::cancelSignIn)
            is SessionStage.SignedIn -> SignedInNavigation(vm, s, onShare)
        }
    }
}

@Composable
private fun SignedInNavigation(
    vm: ChatAppViewModel,
    session: SessionStage.SignedIn,
    onShare: (String, String) -> Unit,
) {
    val nav = rememberNavController()
    val displayName by vm.profile.displayName.collectAsStateWithLifecycle()
    NavHost(navController = nav, startDestination = Routes.WORKSPACES) {
        composable(Routes.WORKSPACES) {
            WorkspacesScreen(
                model = vm.workspaces,
                profile = vm.profile,
                session = session,
                onOpen = { ws ->
                    vm.channels(ws)
                    nav.navigate(Routes.workspace(ws.id))
                },
                onSignOut = { vm.signOut() },
            )
        }
        composable(Routes.WORKSPACE) { entry ->
            val model = entry.arguments?.getString("ws")?.let { vm.channelsOf(it) }
            if (model == null) {
                GoBack(nav)
            } else {
                ChannelsScreen(
                    model = model,
                    workspaces = vm.workspaces,
                    onOpen = { channel ->
                        vm.channel(channel)
                        nav.navigate(Routes.channel(channel.workspaceId, channel.contextId))
                    },
                    onBack = { nav.popBackStack() },
                    onShare = onShare,
                )
            }
        }
        composable(Routes.CHANNEL) { entry ->
            val model = entry.arguments?.getString("ctx")?.let { vm.channelOf(it) }
            if (model == null) {
                GoBack(nav)
            } else {
                ChannelScreen(model = model, displayName = displayName, onBack = { nav.popBackStack() })
            }
        }
    }
}

/** A destination restored after the process died has no model behind it any more: go back up. */
@Composable
private fun GoBack(nav: NavHostController) {
    LaunchedEffect(Unit) { nav.popBackStack(Routes.WORKSPACES, inclusive = false) }
}
