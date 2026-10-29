package network.calimero.issues.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.issues.core.TrackerFormat
import network.calimero.issues.core.WorkspaceModel
import network.calimero.issues.core.WorkspaceState

/** Workspaces, the open workspace's repositories, invitations and the account. */
@Composable
fun WorkspaceScreen(
    workspace: WorkspaceModel,
    ws: WorkspaceState,
    openSheet: (TrackerSheet) -> Unit,
    signOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var confirmSignOut by remember { mutableStateOf(false) }
    LazyColumn(
        Modifier.fillMaxSize().statusBarsPadding(),
        contentPadding = PaddingValues(Palette.gutter),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { Text("Workspace", fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, modifier = Modifier.padding(bottom = 8.dp)) }
        ws.activeWorkspace?.let { ns ->
            item {
                Group(null) {
                    Row(Modifier.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(Palette.lime), contentAlignment = Alignment.Center) {
                            Text(WorkspaceModel.displayName(ns).take(1).uppercase(), fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                        }
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(WorkspaceModel.displayName(ns), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                            Text(if (ns.memberCount == 1) "1 member" else "${ns.memberCount} members", fontSize = 13.sp, color = Palette.text3)
                        }
                    }
                    HorizontalDivider(color = Palette.line)
                    ActionRow(Icons.Outlined.PersonAdd, "Invite people") { openSheet(TrackerSheet.INVITE) }
                }
            }
            item {
                Group("Repositories") {
                    if (ws.repos.isEmpty()) {
                        Text(if (ws.isSyncing) "Syncing…" else "No repos yet", color = Palette.text3, modifier = Modifier.padding(vertical = 12.dp))
                        HorizontalDivider(color = Palette.line)
                    }
                    ws.repos.forEach { repo ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { workspace.selectRepo(repo.id) }
                                .heightIn(min = 52.dp)
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Outlined.Code, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text(repo.name, fontSize = 16.sp, color = Palette.ink)
                                if (repo.url.isNotEmpty()) OneLine(repo.url, size = 12, color = Palette.text3)
                            }
                            if (repo.id == ws.activeRepoId) Icon(Icons.Filled.Check, contentDescription = "Open", tint = Palette.ink)
                        }
                        HorizontalDivider(color = Palette.line)
                    }
                    ActionRow(Icons.Outlined.Add, "Add a repository") { openSheet(TrackerSheet.ADD_REPO) }
                    if (ws.activeRepo != null) {
                        HorizontalDivider(color = Palette.line)
                        ActionRow(Icons.Outlined.Link, "Repository URL") { openSheet(TrackerSheet.REPO_URL) }
                    }
                }
            }
        }
        item {
            Group("Workspaces") {
                ws.workspaces.forEach { ns ->
                    Row(
                        Modifier.fillMaxWidth().clickable { scope.launch { workspace.selectWorkspace(ns.id) } }.heightIn(min = 48.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(WorkspaceModel.displayName(ns), fontSize = 16.sp, color = Palette.ink, modifier = Modifier.weight(1f))
                        if (ns.id == ws.activeWorkspaceId) Icon(Icons.Filled.Check, contentDescription = "Open", tint = Palette.ink)
                    }
                    HorizontalDivider(color = Palette.line)
                }
                ActionRow(Icons.Outlined.Add, "New workspace") { openSheet(TrackerSheet.NEW_WORKSPACE) }
            }
        }
        item {
            Group("Account") {
                Row(Modifier.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(workspace.account, 28.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(TrackerFormat.truncateKey(workspace.account), fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Palette.text2)
                }
                HorizontalDivider(color = Palette.line)
                ActionRow(Icons.AutoMirrored.Outlined.Logout, "Sign out", tint = Palette.danger) { confirmSignOut = true }
            }
        }
        item {
            val rows =
                buildList {
                    add("Account" to workspace.account)
                    add("Relay" to if (workspace.hasRelay) "Connected" else "None yet")
                    ws.activeWorkspaceId?.let { add("Workspace (namespace)" to it) }
                    ws.activeRepoId?.let { add("Repository (context)" to it) }
                }
            Box(Modifier.padding(top = 12.dp)) { DetailsDisclosure(rows) }
        }
    }
    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("Sign out of Mero Issue Tracker?") },
            confirmButton = {
                TextButton(onClick = {
                    confirmSignOut = false
                    signOut()
                }) { Text("Sign out", color = Palette.danger) }
            },
            dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text("Cancel", color = Palette.ink) } },
            containerColor = Palette.surface,
        )
    }
}

@Composable
private fun Group(
    title: String?,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.padding(top = 12.dp)) {
        if (title != null) {
            Text(title.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.text3, modifier = Modifier.padding(start = 4.dp, bottom = 6.dp))
        }
        Column(Modifier.card(PaddingValues(horizontal = 16.dp, vertical = 2.dp)), content = content)
    }
}

private fun Modifier.card(padding: PaddingValues): Modifier =
    this
        .fillMaxWidth()
        .clip(RoundedCornerShape(Palette.radius))
        .background(Palette.surface)
        .padding(padding)

@Composable
private fun ActionRow(
    icon: ImageVector,
    title: String,
    tint: Color = Palette.ink,
    onClick: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Text(title, fontSize = 16.sp, color = tint)
    }
}
