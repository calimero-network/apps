package network.calimero.blocks.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.blocks.app.BlocksInvitation
import network.calimero.blocks.app.BlocksText
import network.calimero.blocks.app.WorldEntry
import network.calimero.blocks.app.WorldRef
import network.calimero.blocks.app.WorldsModel

/** The worlds this account plays in, with who is playing in each. (iOS `WorldsScreen`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorldsScreen(
    backend: MeroAppBackend,
    applicationId: String?,
    onOpen: (WorldRef) -> Unit,
    onJoin: (BlocksInvitation) -> Unit,
    onShare: (String) -> Unit,
    onSettings: () -> Unit,
) {
    val model = remember(backend) { WorldsModel(backend, applicationId) }
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    var creating by remember { mutableStateOf(false) }
    var pasting by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf<WorldRef?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    fun invite(ref: WorldRef) {
        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        scope.launch {
            runCatching { model.inviteLink(ref) }
                .onSuccess(onShare)
                .onFailure { actionError = BlocksText.error(it) }
        }
    }

    fun leave(ref: WorldRef) {
        leaving = null
        scope.launch {
            runCatching { model.leave(ref) }
                .onFailure { actionError = BlocksText.error(it) }
        }
    }

    Scaffold(
        containerColor = BlocksColors.Ground,
        topBar = {
            TopAppBar(
                title = { Text("Worlds", style = Type.heading(20)) },
                navigationIcon = {
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Outlined.Settings, contentDescription = "Settings", tint = BlocksColors.Ink)
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Filled.Add, contentDescription = "Create world", tint = BlocksColors.Ink)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("Create world") },
                                leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null) },
                                enabled = model.hasRelay,
                                onClick = {
                                    menu = false
                                    creating = true
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Join with a link") },
                                leadingIcon = { Icon(Icons.Filled.Link, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    pasting = true
                                },
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = BlocksColors.Ground),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                (state.error ?: actionError)?.let { message ->
                    item {
                        ErrorBanner(message) {
                            model.dismissError()
                            actionError = null
                        }
                    }
                }
                state.notice?.let { notice -> item { NoticeBanner(notice) { model.dismissNotice() } } }
                when {
                    !state.loaded ->
                        item {
                            Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = BlocksColors.Ink, strokeWidth = 2.dp)
                            }
                        }
                    !model.hasRelay ->
                        item {
                            EmptyState(
                                icon = { Icon(Icons.Filled.Link, contentDescription = null, tint = BlocksColors.Ink, modifier = Modifier.size(30.dp)) },
                                title = "Join your first world",
                                text = "Your account has no relay yet. Open an invitation link a friend sent you, or paste it here.",
                                action = "Join with a link",
                            ) { pasting = true }
                        }
                    state.worlds.isEmpty() ->
                        item {
                            EmptyState(
                                icon = { BlockGlyph(Modifier.size(36.dp)) },
                                title = "No worlds yet",
                                text = "Create one, or open an invite link a friend sent you.",
                                action = "Create world",
                            ) { creating = true }
                        }
                    else ->
                        items(state.worlds, key = { it.id }) { entry ->
                            SwipeActions(onInvite = { invite(entry.ref) }, onLeave = { leaving = entry.ref }) {
                                WorldRow(entry) {
                                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                                    onOpen(entry.ref)
                                }
                            }
                        }
                }
            }
        }
    }

    if (creating) {
        NewWorldSheet(
            onCreate = { name, seed -> onOpen(model.create(name, seed)) },
            onDismiss = { creating = false },
        )
    }
    if (pasting) {
        PasteLinkSheet(
            onInvitation = {
                pasting = false
                onJoin(it)
            },
            onDismiss = { pasting = false },
        )
    }
    leaving?.let { world ->
        AlertDialog(
            onDismissRequest = { leaving = null },
            title = { Text("Leave ${world.name}?") },
            text = { Text("It disappears from your list. Someone in it can invite you back.") },
            confirmButton = {
                TextButton(onClick = { leave(world) }) { Text("Leave world", color = BlocksColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { leaving = null }) { Text("Cancel", color = BlocksColors.Ink) } },
            containerColor = BlocksColors.Surface,
        )
    }
}

/** Swipe a row left to invite friends to it, right to leave it; the row springs back. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeActions(
    onInvite: () -> Unit,
    onLeave: () -> Unit,
    content: @Composable () -> Unit,
) {
    val state =
        rememberSwipeToDismissBoxState(
            confirmValueChange = { value ->
                when (value) {
                    SwipeToDismissBoxValue.EndToStart -> onInvite()
                    SwipeToDismissBoxValue.StartToEnd -> onLeave()
                    SwipeToDismissBoxValue.Settled -> Unit
                }
                false
            },
        )
    SwipeToDismissBox(
        state = state,
        backgroundContent = {
            val leaving = state.dismissDirection == SwipeToDismissBoxValue.StartToEnd
            Row(
                Modifier
                    .fillMaxSize()
                    .clip(CardShape)
                    .background(if (leaving) BlocksColors.Danger else BlocksColors.Ink)
                    .padding(horizontal = 20.dp),
                horizontalArrangement = if (leaving) Arrangement.Start else Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (leaving) Icons.AutoMirrored.Filled.Logout else Icons.Filled.PersonAdd,
                    contentDescription = null,
                    tint = BlocksColors.Surface,
                )
                Spacer(Modifier.width(8.dp))
                Text(if (leaving) "Leave" else "Invite", style = Type.body(15, FontWeight.SemiBold, BlocksColors.Surface))
            }
        },
    ) { content() }
}

/** One world in the list. */
@Composable
private fun WorldRow(
    entry: WorldEntry,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(CardShape)
                .background(BlocksColors.Surface)
                .border(Hairline, BlocksColors.Line, CardShape)
                .clickable(onClick = onClick)
                .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        WorldThumb(entry.ref.contextId, Modifier.size(52.dp).clip(RoundedCornerShape(12.dp)))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(entry.ref.name, style = Type.heading(16), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                BlocksText.online(entry.online) ?: "Syncing…",
                style = Type.body(13, color = BlocksColors.Muted),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if ((entry.online ?: 0) > 0) {
            Row(
                Modifier.clip(CircleShape).background(BlocksColors.LimeSoft).padding(horizontal = 10.dp, vertical = 5.dp),
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(BlocksColors.Online))
                Text("Live", style = Type.body(12, FontWeight.SemiBold))
            }
        }
        Box(Modifier.size(32.dp).clip(CircleShape).background(BlocksColors.Lime), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = BlocksColors.Ink, modifier = Modifier.size(18.dp))
        }
    }
}

/**
 * A small landscape for a world: sky, hills and ground in the game's own colours, shaped by the
 * world's id so each row looks its own. Same drawing as the iOS `WorldThumb`.
 */
@Composable
fun WorldThumb(
    seed: String,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier) {
        var hash = FNV_OFFSET
        for (byte in seed.toByteArray(Charsets.UTF_8)) hash = (hash xor (byte.toUInt() and BYTE_MASK)) * FNV_PRIME
        drawRect(Color(0xFF87C4EB))
        val width = size.width / COLUMNS
        for (column in 0 until COLUMNS) {
            hash = hash * LCG_MULTIPLIER + LCG_INCREMENT
            val height = size.height * (0.35f + ((hash shr 16) % 30u).toFloat() / 100f)
            val x = column * width
            val top = size.height - height
            drawRect(Color(0xFF8A5A3B), Offset(x, top), Size(width + 0.5f, height))
            drawRect(Color(0xFF5DAA3C), Offset(x, top), Size(width + 0.5f, size.height * 0.12f))
        }
    }
}

private const val COLUMNS = 6
private const val FNV_OFFSET = 2_166_136_261u
private const val FNV_PRIME = 16_777_619u
private const val LCG_MULTIPLIER = 1_103_515_245u
private const val LCG_INCREMENT = 12_345u
private const val BYTE_MASK = 0xFFu

@Composable
fun EmptyState(
    icon: @Composable () -> Unit,
    title: String,
    text: String,
    action: String,
    onAction: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 40.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(72.dp).clip(RoundedCornerShape(20.dp)).background(BlocksColors.LimeSoft), contentAlignment = Alignment.Center) {
            icon()
        }
        Text(title, style = Type.heading(20))
        Text(text, style = Type.body(15, color = BlocksColors.Muted), textAlign = TextAlign.Center)
        PrimaryButton(onClick = onAction, fullWidth = false, modifier = Modifier.padding(top = 4.dp)) { ButtonLabel(action) }
    }
}

/** A lime banner for something worth knowing that is not an error. */
@Composable
fun NoticeBanner(
    message: String,
    onDismiss: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(ButtonShape)
                .background(BlocksColors.LimeSoft)
                .padding(start = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Filled.Info, contentDescription = null, tint = BlocksColors.Ink, modifier = Modifier.size(20.dp))
        Text(message, style = Type.body(14), modifier = Modifier.weight(1f))
        IconButton(onClick = onDismiss) {
            Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = BlocksColors.Muted, modifier = Modifier.size(18.dp))
        }
    }
}
