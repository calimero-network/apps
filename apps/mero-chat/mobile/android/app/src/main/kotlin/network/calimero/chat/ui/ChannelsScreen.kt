package network.calimero.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Badge
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import network.calimero.chat.app.ChannelsModel
import network.calimero.chat.app.WorkspacesModel
import network.calimero.chat.data.Channel

/** One workspace: its channels and DMs. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelsScreen(
    model: ChannelsModel,
    workspaces: WorkspacesModel,
    onOpen: (Channel) -> Unit,
    onBack: () -> Unit,
    onShare: (title: String, text: String) -> Unit,
) {
    val state by model.state.collectAsStateWithLifecycle()
    val wsState by workspaces.state.collectAsStateWithLifecycle()
    var creating by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(model.workspace.name) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = { workspaces.invite(model.workspace) }) { Icon(Icons.Filled.Share, contentDescription = "Invite people") }
                    IconButton(onClick = { model.refresh() }) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh") }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, contentDescription = "New channel") }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            StatusStrip(
                busy = state.busy ?: wsState.busy ?: if (state.loading) "Loading channels…" else null,
                error = state.error ?: wsState.error,
                notice = state.notice,
                onDismiss = {
                    model.clearMessages()
                    workspaces.clearMessages()
                },
            )
            if (state.loaded && state.channels.isEmpty() && state.dms.isEmpty()) {
                EmptyState(
                    title = "No channels here yet",
                    body = "Right after joining, channels appear once your relay has synced the workspace. Pull them again with refresh, or create one.",
                )
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    item { SectionHeader("Channels") }
                    items(state.channels, key = { it.contextId }) { ch -> ChannelRow(ch, prefix = "#") { model.open(ch, onOpen) } }
                    if (state.dms.isNotEmpty()) {
                        item { SectionHeader("Direct messages") }
                        items(state.dms, key = { it.contextId }) { ch -> ChannelRow(ch, prefix = "") { model.open(ch, onOpen) } }
                    }
                }
            }
        }
    }

    if (creating) {
        CreateChannelDialog(
            onCreate = { name, public ->
                creating = false
                model.create(name, public, onCreated = onOpen)
            },
            onDismiss = { creating = false },
        )
    }

    wsState.invite?.let { invite ->
        InviteDialog(
            workspaceName = invite.workspaceName,
            link = invite.link,
            onShare = {
                onShare("Join ${invite.workspaceName} on Mero Chat", invite.link)
                workspaces.dismissInvite()
            },
            onDismiss = workspaces::dismissInvite,
        )
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun ChannelRow(
    channel: Channel,
    prefix: String,
    onClick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text("$prefix${channel.name}") },
        supportingContent = if (channel.joined) null else ({ Text("Tap to join") }),
        trailingContent =
            if (channel.unread > 0) {
                { Badge { Text(if (channel.unread > MAX_BADGE) "$MAX_BADGE+" else channel.unread.toString()) } }
            } else {
                null
            },
        modifier = Modifier.clickable(onClick = onClick),
    )
    HorizontalDivider()
}

private const val MAX_BADGE = 99
