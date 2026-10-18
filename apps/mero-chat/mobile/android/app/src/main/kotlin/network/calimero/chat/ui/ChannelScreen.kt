package network.calimero.chat.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import network.calimero.chat.app.ChannelModel
import network.calimero.chat.app.ChannelState
import network.calimero.chat.app.LiveMode
import network.calimero.chat.app.MessageItem
import java.text.DateFormat
import java.util.Date

/** One channel: history (newest at the bottom, older on demand), composer, message actions. */
@Composable
fun ChannelScreen(
    model: ChannelModel,
    displayName: String,
    onBack: () -> Unit,
) {
    val state by model.state.collectAsStateWithLifecycle()
    var draft by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<MessageItem?>(null) }
    var actionsFor by remember { mutableStateOf<MessageItem?>(null) }
    var naming by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    DisposableEffect(model) {
        model.start()
        onDispose { model.stop() }
    }

    Scaffold(
        topBar = {
            ChannelTopBar(
                title = if (model.channel.isDm) state.title else "#${state.title}",
                live = state.live,
                onBack = onBack,
                onName = { naming = true },
                onRefresh = { model.refresh() },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().imePadding()) {
            StatusStrip(
                busy = if (state.loading) "Loading messages…" else null,
                error = state.error,
                notice = state.notice,
                onDismiss = model::clearMessages,
            )
            MessageList(
                state = state,
                listState = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                onOlder = { model.loadOlder() },
                onLongPress = { actionsFor = it },
                onReaction = { item, emoji -> model.toggleReaction(item.id, emoji) },
            )
            Composer(
                draft = draft,
                editing = editing,
                onDraft = { draft = it },
                onCancelEdit = {
                    editing = null
                    draft = ""
                },
                onSend = {
                    val target = editing
                    if (target != null) model.edit(target.id, draft) else model.send(draft)
                    editing = null
                    draft = ""
                },
            )
        }
    }

    actionsFor?.let { item ->
        MessageActions(
            item = item,
            onReact = { emoji -> model.toggleReaction(item.id, emoji) },
            onEdit = {
                editing = item
                draft = item.message.text
            },
            onDelete = { model.delete(item.id) },
            onDismiss = { actionsFor = null },
        )
    }

    if (naming) {
        NameInChannelDialog(
            displayName = displayName,
            onSave = {
                naming = false
                model.setProfileName(it)
            },
            onDismiss = { naming = false },
        )
    }
}

@Composable
private fun NameInChannelDialog(
    displayName: String,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit,
) = TextInputDialog(
    title = "Your name in this channel",
    label = "Name",
    confirm = "Save",
    initial = displayName,
    help = "The channel keeps the first name you register in it; later changes do not rename you.",
    onConfirm = onSave,
    onDismiss = onDismiss,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChannelTopBar(
    title: String,
    live: LiveMode,
    onBack: () -> Unit,
    onName: () -> Unit,
    onRefresh: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    TopAppBar(
        title = {
            Column {
                Text(title)
                Text(liveLabel(live), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
        actions = {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Set my name here") }, onClick = {
                    menu = false
                    onName()
                })
                DropdownMenuItem(text = { Text("Refresh") }, onClick = {
                    menu = false
                    onRefresh()
                })
            }
        },
    )
}

@Composable
private fun MessageList(
    state: ChannelState,
    listState: LazyListState,
    modifier: Modifier,
    onOlder: () -> Unit,
    onLongPress: (MessageItem) -> Unit,
    onReaction: (MessageItem, String) -> Unit,
) {
    // Follow the conversation: jump to the newest message when one arrives.
    val newestId = state.messages.lastOrNull()?.id
    LaunchedEffect(newestId, state.pending.size) {
        val last = state.messages.size + state.pending.size
        if (last > 0) listState.animateScrollToItem(last)
    }
    LazyColumn(state = listState, modifier = modifier, contentPadding = PaddingValues(vertical = 8.dp)) {
        item(key = "older") {
            if (state.hasOlder) {
                TextButton(onClick = onOlder, enabled = !state.loadingOlder, modifier = Modifier.fillMaxWidth()) {
                    Text(if (state.loadingOlder) "Loading…" else "Load earlier messages")
                }
            } else if (!state.loading && state.messages.isEmpty()) {
                EmptyState(title = "No messages yet", body = "Say hello.", modifier = Modifier.padding(top = 48.dp))
            }
        }
        items(state.messages, key = { it.id }) { item ->
            MessageRow(item, onLongPress = { onLongPress(item) }, onReaction = { emoji -> onReaction(item, emoji) })
        }
        items(state.pending.size) { i -> PendingRow(state.pending[i]) }
    }
}

private fun liveLabel(mode: LiveMode): String =
    when (mode) {
        LiveMode.STREAM -> "Live"
        LiveMode.POLLING -> "Refreshing every few seconds"
        LiveMode.OFF -> ""
    }

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(
    item: MessageItem,
    onLongPress: () -> Unit,
    onReaction: (String) -> Unit,
) {
    val m = item.message
    Column(
        Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = {}, onLongClick = onLongPress)
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalAlignment = if (item.mine) Alignment.End else Alignment.Start,
    ) {
        Text(
            "${if (item.mine) "You" else item.author} · ${formatTime(m.timestamp)}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Surface(
            color = if (item.mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            shape = MaterialTheme.shapes.medium,
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                if (m.isDeleted) {
                    Text("Message deleted", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    if (m.text.isNotEmpty()) Text(m.text, style = MaterialTheme.typography.bodyLarge)
                    (m.images + m.files).forEach { a -> Text("📎 ${a.name}", style = MaterialTheme.typography.bodySmall) }
                    if (m.isEdited) Text("edited", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (item.reactions.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                item.reactions.forEach { r ->
                    FilterChip(selected = r.mine, onClick = { onReaction(r.emoji) }, label = { Text("${r.emoji} ${r.count}") })
                }
            }
        }
        if (m.threadCount > 0) {
            Text("${m.threadCount} replies in a thread (open it on the web or desktop)", style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun PendingRow(text: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalAlignment = Alignment.End) {
        Text("Sending…", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
            Text(text, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Composer(
    draft: String,
    editing: MessageItem?,
    onDraft: (String) -> Unit,
    onCancelEdit: () -> Unit,
    onSend: () -> Unit,
) {
    Surface(tonalElevation = 2.dp) {
        Column(Modifier.fillMaxWidth().padding(8.dp)) {
            if (editing != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Editing your message", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                    IconButton(onClick = onCancelEdit) { Icon(Icons.Filled.Close, contentDescription = "Stop editing") }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = onDraft,
                    placeholder = { Text("Message") },
                    modifier = Modifier.weight(1f),
                    maxLines = 5,
                )
                IconButton(onClick = onSend, enabled = draft.isNotBlank()) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = if (editing != null) "Save" else "Send")
                }
            }
        }
    }
}

@Composable
private fun MessageActions(
    item: MessageItem,
    onReact: (String) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Message") },
        text = {
            Column {
                if (!item.message.isDeleted) {
                    ChannelModel.QUICK_REACTIONS.chunked(REACTIONS_PER_ROW).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            row.forEach { emoji ->
                                val mine = item.reactions.any { it.emoji == emoji && it.mine }
                                FilterChip(selected = mine, onClick = {
                                    onReact(emoji)
                                    onDismiss()
                                }, label = { Text(emoji) })
                            }
                        }
                    }
                }
                if (item.mine && !item.message.isDeleted) {
                    TextButton(onClick = {
                        onEdit()
                        onDismiss()
                    }) { Text("Edit") }
                    TextButton(onClick = {
                        onDelete()
                        onDismiss()
                    }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

private fun formatTime(epochSecs: Long): String =
    if (epochSecs <= 0) "" else DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(epochSecs * MILLIS))

private const val MILLIS = 1000L
private const val REACTIONS_PER_ROW = 3
