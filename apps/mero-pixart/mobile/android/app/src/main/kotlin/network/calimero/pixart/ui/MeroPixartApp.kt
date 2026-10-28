package network.calimero.pixart.ui

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.calimero.mero.app.MeroAppBackend
import network.calimero.pixart.app.Destination
import network.calimero.pixart.app.PixartAppViewModel
import network.calimero.pixart.core.InvitationModel

/** Restoring → a splash. Signed out → sign in. Signed in → teams, projects, an artwork. */
@Composable
fun MeroPixartApp(
    vm: PixartAppViewModel,
    onSignIn: () -> Unit,
) {
    PixartMaterialTheme {
        val restored by vm.restored.collectAsState()
        val restoring by vm.session.isRestoring.collectAsState()
        val backend by vm.session.backend.collectAsState()
        val revision by vm.session.revision.collectAsState()
        val auth by vm.session.client.state
            .collectAsState()
        val stage by vm.invitation.stage.collectAsState()

        when {
            !restored || restoring -> Splash("Restoring your session…")
            auth.isDelegated && backend != null ->
                key(revision) {
                    SignedIn(vm, backend!!)
                }
            auth.isDelegated -> Splash("Connecting to your relay…") { SecondaryButton(onClick = vm::signOut, fullWidth = false) { Text("Sign out") } }
            else -> SignInScreen(auth = auth, onSignIn = onSignIn, onCancel = { vm.session.cancelSignIn() })
        }

        InvitationPrompt(stage, onJoin = vm::acceptInvitation, onDismiss = vm.invitation::reset)
    }
}

/** Confirm, joining, or why it failed. */
@Composable
private fun InvitationPrompt(
    stage: InvitationModel.Stage,
    onJoin: () -> Unit,
    onDismiss: () -> Unit,
) {
    when (stage) {
        is InvitationModel.Stage.Confirm ->
            AlertDialog(
                onDismissRequest = onDismiss,
                title = { Text("Join this team?") },
                text = { Text("You've been invited to ${stage.title}. Join to see its projects here and on the web.") },
                confirmButton = { TextButton(onClick = onJoin) { Text("Join", fontWeight = FontWeight.SemiBold) } },
                dismissButton = { TextButton(onClick = onDismiss) { Text("Not now") } },
            )
        is InvitationModel.Stage.Failed ->
            AlertDialog(
                onDismissRequest = onDismiss,
                title = { Text("Couldn't join") },
                text = { Text(stage.message) },
                confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
            )
        is InvitationModel.Stage.Joining ->
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                Column(Modifier.card(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                    Text("Joining ${stage.title}…", style = PixartTheme.body(15, FontWeight.Medium, PixartTheme.ink))
                }
            }
        else -> Unit
    }
}

@Composable
private fun SignedIn(
    vm: PixartAppViewModel,
    backend: MeroAppBackend,
) {
    val nav = rememberNavController()
    val destination by vm.destination.collectAsState()
    LaunchedEffect(destination) {
        when (val d = destination) {
            is Destination.Project -> {
                nav.navigate("team/${d.teamId}?name=${Uri.encode("Projects")}") { popUpTo("teams") }
                nav.navigate("project/${d.teamId}/${d.contextId}?name=")
            }
            is Destination.Team -> nav.navigate("team/${d.teamId}?name=${Uri.encode(d.name)}") { popUpTo("teams") }
            null -> return@LaunchedEffect
        }
        vm.destinationOpened()
    }
    NavHost(navController = nav, startDestination = "teams", modifier = Modifier.background(PixartTheme.ground)) {
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
            ProjectsScreen(
                backend = backend,
                teamId = teamId,
                teamName = entry.arguments?.getString("name").orEmpty(),
                blobs = vm.blobs,
                onBack = { nav.popBackStack() },
                onOpen = { p -> nav.navigate("project/$teamId/${p.contextId}?name=${Uri.encode(p.name)}") },
            )
        }
        composable(
            "project/{teamId}/{contextId}?name={name}",
            arguments =
                listOf(
                    navArgument("teamId") { type = NavType.StringType },
                    navArgument("contextId") { type = NavType.StringType },
                    navArgument("name") { defaultValue = "" },
                ),
        ) { entry ->
            ArtworkScreen(
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
    Box(Modifier.fillMaxSize().background(PixartTheme.ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(52.dp)
            CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            Text(text, style = PixartTheme.body(14, color = PixartTheme.muted))
            actions()
        }
    }
}
