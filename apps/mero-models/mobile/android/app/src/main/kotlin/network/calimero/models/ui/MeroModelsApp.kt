package network.calimero.models.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.calimero.mero.app.MeroAppBackend
import network.calimero.models.app.ModelsAppViewModel
import network.calimero.models.app.SceneLink
import network.calimero.models.core.InvitationModel

/** Restoring → a splash. Signed out → sign in. Signed in → studios, scenes, a scene. */
@Composable
fun MeroModelsApp(
    vm: ModelsAppViewModel,
    onSignIn: () -> Unit,
) {
    ModelsMaterialTheme {
        val restored by vm.restored.collectAsState()
        val restoring by vm.session.isRestoring.collectAsState()
        val backend by vm.session.backend.collectAsState()
        val revision by vm.session.revision.collectAsState()
        val auth by vm.session.client.state
            .collectAsState()
        val pendingInvitation by vm.session.pendingInvitation.collectAsState()
        val stage by vm.invitation.stage.collectAsState()

        LaunchedEffect(pendingInvitation) {
            val raw = pendingInvitation ?: return@LaunchedEffect
            vm.openInvitation(raw)
            vm.session.dismissPendingInvitation()
        }

        when {
            !restored || restoring -> Splash("Restoring your session…")
            auth.isDelegated && backend != null ->
                key(revision) {
                    SignedIn(vm, backend!!)
                }
            auth.isDelegated -> Splash("Connecting to your relay…") { SecondaryButton(onClick = vm::signOut, fullWidth = false) { Text("Sign out") } }
            else -> SignInScreen(auth = auth, onSignIn = onSignIn, onCancel = { vm.session.cancelSignIn() })
        }

        if (stage != InvitationModel.Stage.Idle) {
            InvitationSheet(
                stage = stage,
                signedIn = auth.isDelegated,
                onAccept = vm::acceptInvitation,
                onDismiss = { vm.invitation.reset() },
                onOpen = { studioId, contextId ->
                    vm.invitation.reset()
                    vm.open(SceneLink(studioId, contextId))
                },
            )
        }
    }
}

@Composable
private fun SignedIn(
    vm: ModelsAppViewModel,
    backend: MeroAppBackend,
) {
    val nav = rememberNavController()
    val openScene by vm.openScene.collectAsState()
    LaunchedEffect(openScene) {
        val link = openScene ?: return@LaunchedEffect
        nav.navigate("studio/${link.studioId}?name=${Uri.encode("Scenes")}") { popUpTo("studios") }
        nav.navigate("scene/${link.studioId}/${link.contextId}?name=")
        vm.sceneOpened()
    }
    NavHost(navController = nav, startDestination = "studios", modifier = Modifier.background(ModelsTheme.ground)) {
        composable("studios") {
            StudiosScreen(
                backend = backend,
                session = vm.session,
                invitation = vm.invitation,
                onJoin = vm::openInvitation,
                onSignOut = vm::signOut,
                onOpen = { studio -> nav.navigate("studio/${studio.id}?name=${Uri.encode(studio.name)}") },
            )
        }
        composable(
            "studio/{studioId}?name={name}",
            arguments = listOf(navArgument("studioId") { type = NavType.StringType }, navArgument("name") { defaultValue = "" }),
        ) { entry ->
            val studioId = entry.arguments?.getString("studioId").orEmpty()
            ScenesScreen(
                backend = backend,
                studioId = studioId,
                studioName = entry.arguments?.getString("name").orEmpty(),
                onBack = { nav.popBackStack() },
                onOpen = { scene -> nav.navigate("scene/$studioId/${scene.contextId}?name=${Uri.encode(scene.name)}") },
            )
        }
        composable(
            "scene/{studioId}/{contextId}?name={name}",
            arguments =
                listOf(
                    navArgument("studioId") { type = NavType.StringType },
                    navArgument("contextId") { type = NavType.StringType },
                    navArgument("name") { defaultValue = "" },
                ),
        ) { entry ->
            SceneScreen(
                backend = backend,
                studioId = entry.arguments?.getString("studioId").orEmpty(),
                contextId = entry.arguments?.getString("contextId").orEmpty(),
                name = entry.arguments?.getString("name").orEmpty(),
                blobs = vm.blobs,
                onBack = { nav.popBackStack() },
            )
        }
    }
}

/** Confirm an invitation, join, and open the scene it names. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvitationSheet(
    stage: InvitationModel.Stage,
    signedIn: Boolean,
    onAccept: () -> Unit,
    onDismiss: () -> Unit,
    onOpen: (String, String) -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = ModelsTheme.ground) {
        Column(
            Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when (stage) {
                InvitationModel.Stage.Idle, InvitationModel.Stage.Confirm -> {
                    SheetHeader(Icons.Outlined.PersonAdd, "Join this studio?")
                    SheetText("Joining makes you a member of the studio this scene belongs to, so you can open every scene in it.")
                    Spacer(Modifier.height(8.dp))
                    if (signedIn) {
                        PrimaryButton(onClick = onAccept) { Text("Join and open", style = ModelsTheme.body(16, FontWeight.SemiBold, ModelsTheme.ink)) }
                    } else {
                        SheetText("Sign in first, then open the link again.")
                    }
                    SecondaryButton(onClick = onDismiss) { Text("Not now") }
                }
                InvitationModel.Stage.Joining -> {
                    SheetHeader(Icons.Outlined.HourglassEmpty, "Joining…")
                    CircularProgressIndicator(color = ModelsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                }
                is InvitationModel.Stage.Joined -> {
                    SheetHeader(Icons.Outlined.CheckCircle, "You're in")
                    SheetText("The scene syncs from the other members. It may take a moment to appear in full.")
                    Spacer(Modifier.height(8.dp))
                    PrimaryButton(onClick = { onOpen(stage.namespaceId, stage.contextId) }) {
                        Text("Open the scene", style = ModelsTheme.body(16, FontWeight.SemiBold, ModelsTheme.ink))
                    }
                }
                is InvitationModel.Stage.Failed -> {
                    SheetHeader(Icons.Outlined.WarningAmber, "Couldn't join")
                    SheetText(stage.message)
                    Spacer(Modifier.height(8.dp))
                    SecondaryButton(onClick = onDismiss) { Text("Close") }
                }
            }
        }
    }
}

@Composable
private fun SheetHeader(
    icon: ImageVector,
    title: String,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(60.dp).background(ModelsTheme.lime, CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = ModelsTheme.ink, modifier = Modifier.size(26.dp))
        }
        Text(title, style = ModelsTheme.heading(20))
    }
}

@Composable
private fun SheetText(text: String) {
    Text(text, style = ModelsTheme.body(15, color = ModelsTheme.muted), textAlign = TextAlign.Center)
}

@Composable
fun Splash(
    text: String,
    actions: @Composable () -> Unit = {},
) {
    Box(Modifier.fillMaxSize().background(ModelsTheme.ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(52.dp)
            CircularProgressIndicator(color = ModelsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            Text(text, style = ModelsTheme.body(14, color = ModelsTheme.muted))
            actions()
        }
    }
}
