package network.calimero.design.ui

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import network.calimero.design.app.DesignAppViewModel

/** Restoring → a splash. Signed out → sign in. Signed in → teams, boards, a board. */
@Composable
fun MeroDesignApp(
    vm: DesignAppViewModel,
    onSignIn: () -> Unit,
) {
    DesignMaterialTheme {
        val restored by vm.restored.collectAsState()
        val restoring by vm.session.isRestoring.collectAsState()
        val backend by vm.session.backend.collectAsState()
        val revision by vm.session.revision.collectAsState()
        val auth by vm.session.client.state
            .collectAsState()
        val pendingInvitation by vm.session.pendingInvitation.collectAsState()

        when {
            !restored || restoring -> Splash("Restoring your session…")
            auth.isDelegated && backend != null ->
                key(revision) {
                    SignedIn(vm, backend!!)
                }
            auth.isDelegated -> Splash("Connecting to your relay…") { SecondaryButton(onClick = vm::signOut, fullWidth = false) { Text("Sign out") } }
            else -> SignInScreen(auth = auth, onSignIn = onSignIn, onCancel = { vm.session.cancelSignIn() })
        }

        if (pendingInvitation != null) {
            AlertDialog(
                onDismissRequest = { vm.session.dismissPendingInvitation() },
                confirmButton = { TextButton(onClick = { vm.session.dismissPendingInvitation() }) { Text("OK") } },
                title = { Text("Open the invitation on the web") },
                text = {
                    Text(
                        "This app views boards in teams you are already in. Accept the invitation in Mero Design on the web or desktop, and the team appears here.",
                    )
                },
            )
        }
    }
}

@Composable
private fun SignedIn(
    vm: DesignAppViewModel,
    backend: com.calimero.mero.app.MeroAppBackend,
) {
    val nav = rememberNavController()
    val openBoard by vm.openBoard.collectAsState()
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
                session = vm.session,
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
