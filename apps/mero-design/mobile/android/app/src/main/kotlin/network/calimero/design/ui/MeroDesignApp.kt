package network.calimero.design.ui

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import network.calimero.design.app.DesignAppViewModel
import network.calimero.design.core.DesignFormat

/** Restoring → a splash. Signed out → sign in. Signed in → teams, boards, a board. */
@Composable
fun MeroDesignApp(
    vm: DesignAppViewModel,
    activity: Context,
) {
    DesignMaterialTheme {
        val restored by vm.restored.collectAsState()
        val backend by vm.backend.collectAsState()
        val revision by vm.revision.collectAsState()
        val invitation by vm.pendingInvitation.collectAsState()
        val scope = rememberCoroutineScope()
        var joining by remember { mutableStateOf(false) }
        var joinError by remember { mutableStateOf<String?>(null) }
        var joinedTeam by remember { mutableStateOf<String?>(null) }

        val current = backend
        when {
            !restored -> Splash("Restoring your session…")
            current != null -> key(revision) { SignedIn(vm, current, joinedTeam) { joinedTeam = null } }
            else -> SignInScreen(vm, activity)
        }

        if (invitation != null && current != null && !joining) {
            AlertDialog(
                onDismissRequest = { vm.dismissInvitation() },
                title = { Text(invitation?.name?.let { "Join $it?" } ?: "Join this team?") },
                text = { Text("You were invited to a team on Mero Design. Its boards show up here once you join.") },
                confirmButton = {
                    TextButton(onClick = {
                        joining = true
                        scope.launch {
                            try {
                                joinedTeam = vm.joinInvitation()
                            } catch (e: CancellationException) {
                                throw e
                            } catch (
                                @Suppress("TooGenericExceptionCaught") e: Exception,
                            ) {
                                vm.dismissInvitation()
                                joinError = DesignFormat.errorText(e)
                            } finally {
                                joining = false
                            }
                        }
                    }) { Text("Join") }
                },
                dismissButton = { TextButton(onClick = { vm.dismissInvitation() }) { Text("Not now") } },
            )
        }
        if (joining) Splash("Joining…")
        joinError?.let {
            AlertDialog(
                onDismissRequest = { joinError = null },
                title = { Text("Couldn't join") },
                text = { Text(it) },
                confirmButton = { TextButton(onClick = { joinError = null }) { Text("OK") } },
            )
        }
    }
}

@Composable
private fun SignedIn(
    vm: DesignAppViewModel,
    backend: com.calimero.mero.app.MeroAppBackend,
    joinedTeam: String?,
    onJoinedShown: () -> Unit,
) {
    val nav = rememberNavController()
    val openBoard by vm.openBoard.collectAsState()
    LaunchedEffect(joinedTeam) {
        val team = joinedTeam ?: return@LaunchedEffect
        nav.navigate("team/$team?name=${Uri.encode("Boards")}") { popUpTo("teams") }
        onJoinedShown()
    }
    LaunchedEffect(openBoard) {
        val link = openBoard ?: return@LaunchedEffect
        nav.navigate("team/${link.teamId}?name=${Uri.encode("Boards")}") { popUpTo("teams") }
        nav.navigate("board/${link.teamId}/${link.contextId}?name=")
        vm.boardOpened()
    }
    NavHost(navController = nav, startDestination = "teams", modifier = Modifier.background(DesignTheme.ground)) {
        composable("teams") {
            TeamsScreen(
                backend = backend,
                vm = vm,
                onSignOut = vm::signOut,
                onOpen = { team -> nav.navigate("team/${team.id}?name=${Uri.encode(team.name)}") },
            )
        }
        composable(
            "team/{teamId}?name={name}",
            arguments = listOf(navArgument("teamId") { type = NavType.StringType }, navArgument("name") { defaultValue = "" }),
        ) { entry ->
            val teamId = entry.arguments?.getString("teamId").orEmpty()
            BoardsScreen(
                backend = backend,
                teamId = teamId,
                teamName = entry.arguments?.getString("name").orEmpty(),
                onBack = { nav.popBackStack() },
                onOpen = { board -> nav.navigate("board/$teamId/${board.contextId}?name=${Uri.encode(board.name)}") },
            )
        }
        composable(
            "board/{teamId}/{contextId}?name={name}",
            arguments =
                listOf(
                    navArgument("teamId") { type = NavType.StringType },
                    navArgument("contextId") { type = NavType.StringType },
                    navArgument("name") { defaultValue = "" },
                ),
        ) { entry ->
            BoardScreen(
                backend = backend,
                teamId = entry.arguments?.getString("teamId").orEmpty(),
                contextId = entry.arguments?.getString("contextId").orEmpty(),
                name = entry.arguments?.getString("name").orEmpty(),
                blobs = vm.blobs,
                onBack = { nav.popBackStack() },
            )
        }
    }
}

@Composable
fun Splash(
    text: String,
    actions: @Composable () -> Unit = {},
) {
    Box(Modifier.fillMaxSize().background(DesignTheme.ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(52.dp)
            CircularProgressIndicator(color = DesignTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            Text(text, style = DesignTheme.body(14, color = DesignTheme.muted))
            actions()
        }
    }
}
