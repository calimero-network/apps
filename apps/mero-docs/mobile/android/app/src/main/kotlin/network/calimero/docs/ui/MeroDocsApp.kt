package network.calimero.docs.ui

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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.calimero.mero.app.MeroAppBackend
import network.calimero.docs.app.DocsAppViewModel
import network.calimero.docs.app.DocumentModel
import network.calimero.docs.app.Workspace
import network.calimero.docs.core.DocTarget

/** Restoring → a splash. Signed out → sign in. Signed in → workspaces, folders, a document. */
@Composable
fun MeroDocsApp(
    vm: DocsAppViewModel,
    onSignIn: () -> Unit,
) {
    DocsMaterialTheme {
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
                        "This app reads workspaces you are already in. Accept the invitation in Mero Docs on the web or desktop, and the workspace appears here.",
                    )
                },
            )
        }
    }
}

/** The route to a document. */
fun docRoute(
    target: DocTarget,
    contextId: String? = null,
    title: String? = null,
): String =
    "doc/${Uri.encode(target.workspaceId)}/${Uri.encode(target.folderId)}/${Uri.encode(target.docId)}" +
        "?ctx=${Uri.encode(contextId.orEmpty())}&title=${Uri.encode(title.orEmpty())}&block=${Uri.encode(target.blockId.orEmpty())}"

fun NavHostController.openDoc(
    target: DocTarget,
    contextId: String? = null,
    title: String? = null,
) = navigate(docRoute(target, contextId, title))

@Suppress("LongMethod")
@Composable
private fun SignedIn(
    vm: DocsAppViewModel,
    backend: MeroAppBackend,
) {
    val nav = rememberNavController()
    val openDoc by vm.openDoc.collectAsState()
    LaunchedEffect(openDoc) {
        val target = openDoc ?: return@LaunchedEffect
        nav.navigate("workspace/${Uri.encode(target.workspaceId)}?name=") { popUpTo("workspaces") }
        nav.openDoc(target)
        vm.docOpened()
    }
    NavHost(navController = nav, startDestination = "workspaces", modifier = Modifier.background(DocsTheme.ground)) {
        composable("workspaces") {
            WorkspacesScreen(
                backend = backend,
                session = vm.session,
                onSignOut = vm::signOut,
                onOpen = { ws -> nav.navigate("workspace/${Uri.encode(ws.id)}?name=${Uri.encode(ws.name)}") },
            )
        }
        composable(
            "workspace/{id}?name={name}",
            arguments = listOf(navArgument("id") { type = NavType.StringType }, navArgument("name") { defaultValue = "" }),
        ) { entry ->
            val id = entry.arguments?.getString("id").orEmpty()
            val name = entry.arguments?.getString("name").orEmpty()
            val model = remember(id) { vm.workspaceModel(backend, Workspace(id, name, 0)) }
            WorkspaceScreen(
                model = model,
                onBack = { nav.popBackStack() },
                onOpenFolder = { folder -> nav.navigate("folder/${Uri.encode(id)}/${Uri.encode(folder.id)}") },
                onOpenDoc = { row -> nav.openDoc(DocTarget(id, row.folderId, row.doc.id), row.contextId, row.title) },
            )
        }
        composable(
            "folder/{ws}/{folder}",
            arguments = listOf(navArgument("ws") { type = NavType.StringType }, navArgument("folder") { type = NavType.StringType }),
        ) { entry ->
            val ws = entry.arguments?.getString("ws").orEmpty()
            val model = remember(ws) { vm.workspaceModel(backend, Workspace(ws, "", 0)) }
            FolderScreen(
                model = model,
                folderId = entry.arguments?.getString("folder").orEmpty(),
                onBack = { nav.popBackStack() },
                onOpenFolder = { folder -> nav.navigate("folder/${Uri.encode(ws)}/${Uri.encode(folder.id)}") },
                onOpenDoc = { row -> nav.openDoc(DocTarget(ws, row.folderId, row.doc.id), row.contextId, row.title) },
            )
        }
        composable(
            "doc/{ws}/{folder}/{doc}?ctx={ctx}&title={title}&block={block}",
            arguments =
                listOf(
                    navArgument("ws") { type = NavType.StringType },
                    navArgument("folder") { type = NavType.StringType },
                    navArgument("doc") { type = NavType.StringType },
                    navArgument("ctx") { defaultValue = "" },
                    navArgument("title") { defaultValue = "" },
                    navArgument("block") { defaultValue = "" },
                ),
        ) { entry ->
            val args = entry.arguments
            val ws = args?.getString("ws").orEmpty()
            val folder = args?.getString("folder").orEmpty()
            val doc = args?.getString("doc").orEmpty()
            val model =
                remember(ws, folder, doc) {
                    DocumentModel(
                        backend = backend,
                        workspaceId = ws,
                        folderId = folder,
                        docId = doc,
                        contextId = args?.getString("ctx")?.ifEmpty { null },
                        folderName =
                            vm
                                .workspaceModel(backend, Workspace(ws, "", 0))
                                .folder(folder)
                                ?.name
                                .orEmpty(),
                        title = args?.getString("title")?.ifEmpty { null },
                        blobs = vm.blobs,
                        recents = vm.recents,
                    )
                }
            DocumentScreen(
                model = model,
                focusBlock = args?.getString("block")?.ifEmpty { null },
                onBack = { nav.popBackStack() },
                onOpenDoc = { target -> nav.openDoc(target) },
            )
        }
    }
}

@Composable
fun Splash(
    text: String,
    actions: @Composable () -> Unit = {},
) {
    Box(Modifier.fillMaxSize().background(DocsTheme.ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(52.dp)
            CircularProgressIndicator(color = DocsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            Text(text, style = DocsTheme.body(14, color = DocsTheme.muted))
            actions()
        }
    }
}
