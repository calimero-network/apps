package network.calimero.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import network.calimero.chat.app.ProfileStore
import network.calimero.chat.app.SessionStage
import network.calimero.chat.app.WorkspacesModel
import network.calimero.chat.app.WorkspacesState
import network.calimero.chat.data.Workspace

private enum class WorkspaceDialog { NONE, CREATE, JOIN, NAME }

/** The account's workspaces (namespaces running chat), with create and join. */
@Composable
fun WorkspacesScreen(
    model: WorkspacesModel,
    profile: ProfileStore,
    session: SessionStage.SignedIn,
    onOpen: (Workspace) -> Unit,
    onSignOut: () -> Unit,
) {
    val state by model.state.collectAsStateWithLifecycle()
    val name by profile.displayName.collectAsStateWithLifecycle()
    var dialog by remember { mutableStateOf(if (name.isBlank()) WorkspaceDialog.NAME else WorkspaceDialog.NONE) }

    // Re-list whenever the relay situation changes: a join can give the account its first relay,
    // and listings need the relay session.
    LaunchedEffect(session.relayUrl, session.live) { model.refresh() }

    Scaffold(
        topBar = {
            WorkspacesTopBar(
                onRefresh = { model.refresh() },
                onName = { dialog = WorkspaceDialog.NAME },
                onJoin = { dialog = WorkspaceDialog.JOIN },
                onSignOut = onSignOut,
            )
        },
        floatingActionButton = {
            if (session.hasRelay) {
                ExtendedFloatingActionButton(
                    onClick = { dialog = WorkspaceDialog.CREATE },
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text("New workspace") },
                )
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            StatusStrip(
                busy = state.busy ?: if (session.connecting) "Connecting to your relay…" else null,
                error = state.error,
                notice = state.notice ?: session.note,
                onDismiss = model::clearMessages,
            )
            WorkspacesBody(state, session, onJoin = { dialog = WorkspaceDialog.JOIN }, onOpen = onOpen)
        }
    }

    WorkspaceDialogs(dialog, model, profile, name, onClose = { dialog = WorkspaceDialog.NONE })

    state.pendingInvite?.let { invite ->
        AlertDialog(
            onDismissRequest = model::dismissPendingInvite,
            title = { Text("Join ${invite.workspaceName ?: "this workspace"}?") },
            text = {
                Text(
                    "Your account will be admitted through a relay the invitation names. You'll join as \"${name.ifBlank { "(set your name first)" }}\".",
                    style = MaterialTheme.typography.bodyMedium,
                )
            },
            confirmButton = { TextButton(onClick = { model.acceptPendingInvite() }) { Text("Join") } },
            dismissButton = { TextButton(onClick = model::dismissPendingInvite) { Text("Not now") } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WorkspacesTopBar(
    onRefresh: () -> Unit,
    onName: () -> Unit,
    onJoin: () -> Unit,
    onSignOut: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    TopAppBar(
        title = { Text("Workspaces") },
        actions = {
            IconButton(onClick = onRefresh) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh") }
            IconButton(onClick = onName) { Icon(Icons.Filled.Person, contentDescription = "Your name") }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Join with a link") }, onClick = {
                        menu = false
                        onJoin()
                    })
                    DropdownMenuItem(text = { Text("Sign out") }, onClick = {
                        menu = false
                        onSignOut()
                    })
                }
            }
        },
    )
}

@Composable
private fun WorkspacesBody(
    state: WorkspacesState,
    session: SessionStage.SignedIn,
    onJoin: () -> Unit,
    onOpen: (Workspace) -> Unit,
) {
    when {
        !session.hasRelay ->
            EmptyState(
                title = "Join your first workspace",
                body =
                    "No relay serves your account yet, which is normal for a new account. Open an invitation " +
                        "link someone sent you (or paste it here) to join their workspace.",
                action = { Button(onClick = onJoin) { Text("Paste an invitation link") } },
            )
        state.workspaces.isEmpty() && state.loaded && !state.loading ->
            EmptyState(
                title = "No workspaces yet",
                body = "Create one and invite people, or join one from an invitation link.",
                action = { TextButton(onClick = onJoin) { Text("Join with a link") } },
            )
        else ->
            LazyColumn(Modifier.fillMaxSize()) {
                items(state.workspaces, key = { it.id }) { ws ->
                    ListItem(
                        headlineContent = { Text(ws.name) },
                        supportingContent = { Text(if (ws.memberCount > 0) "${ws.memberCount} members" else ws.id.take(SHORT_ID)) },
                        modifier = Modifier.clickable { onOpen(ws) },
                    )
                    HorizontalDivider()
                }
            }
    }
}

@Composable
private fun WorkspaceDialogs(
    dialog: WorkspaceDialog,
    model: WorkspacesModel,
    profile: ProfileStore,
    name: String,
    onClose: () -> Unit,
) {
    when (dialog) {
        WorkspaceDialog.CREATE ->
            TextInputDialog(
                title = "New workspace",
                label = "Workspace name",
                confirm = "Create",
                help = "You'll be its admin. A #general channel is created with it.",
                onConfirm = {
                    onClose()
                    model.create(it)
                },
                onDismiss = onClose,
            )
        WorkspaceDialog.JOIN ->
            TextInputDialog(
                title = "Join a workspace",
                label = "Invitation link",
                confirm = "Continue",
                onConfirm = {
                    onClose()
                    model.offerInvite(it)
                },
                onDismiss = onClose,
            )
        WorkspaceDialog.NAME ->
            TextInputDialog(
                title = "Your name",
                label = "Name",
                confirm = "Save",
                initial = name,
                help = "Shown next to your messages. Each channel keeps the name you first joined it with.",
                onConfirm = {
                    profile.setDisplayName(it)
                    onClose()
                },
                onDismiss = onClose,
            )
        WorkspaceDialog.NONE -> Unit
    }
}

private const val SHORT_ID = 12

/** The invitation-link dialog, shared by the workspace and channel screens. */
@Composable
fun InviteDialog(
    workspaceName: String,
    link: String,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Invite to $workspaceName") },
        text = {
            Column {
                Text("Anyone with this link can join with their Calimero account.", style = MaterialTheme.typography.bodyMedium)
                Text(link, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
            }
        },
        confirmButton = { TextButton(onClick = onShare) { Text("Share") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}
