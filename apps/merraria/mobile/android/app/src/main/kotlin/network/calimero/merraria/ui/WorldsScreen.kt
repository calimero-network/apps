package network.calimero.merraria.ui

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Settings
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.merraria.app.MerrariaText
import network.calimero.merraria.app.PlayerSettings
import network.calimero.merraria.app.WorldEntry
import network.calimero.merraria.app.WorldInvitation
import network.calimero.merraria.app.WorldRef
import network.calimero.merraria.app.WorldsModel

/** The worlds this account plays in: open one, make one, join one from a link, invite to one. (iOS `WorldsScreen`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorldsScreen(
    backend: MeroAppBackend,
    applicationId: String?,
    account: String,
    settings: PlayerSettings,
    onPlay: (WorldRef) -> Unit,
    onJoin: (WorldInvitation) -> Unit,
    onShare: (String) -> Unit,
    onSignOut: () -> Unit,
) {
    val model = remember(backend) { WorldsModel(backend, applicationId) }
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var creating by remember { mutableStateOf(false) }
    var pasting by remember { mutableStateOf(false) }
    var showingSettings by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    fun invite(ref: WorldRef) {
        scope.launch {
            runCatching { model.inviteLink(ref) }
                .onSuccess(onShare)
                .onFailure { actionError = MerrariaText.error(it) }
        }
    }

    Scaffold(
        containerColor = MerrariaColors.Ground,
        topBar = {
            TopAppBar(
                title = { Text("Worlds", style = Type.heading(20)) },
                navigationIcon = {
                    IconButton(onClick = { showingSettings = true }) {
                        Icon(Icons.Outlined.Settings, contentDescription = "Settings", tint = MerrariaColors.Ink)
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) {
                            Icon(Icons.Filled.Add, contentDescription = "Create or join a world", tint = MerrariaColors.Ink)
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
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MerrariaColors.Ground),
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
                when {
                    !state.loaded ->
                        item {
                            Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = MerrariaColors.Ink, strokeWidth = 2.dp)
                            }
                        }
                    !model.hasRelay ->
                        item {
                            EmptyState(
                                title = "Join your first world",
                                text = "Your account has no relay yet. Open an invitation link a friend sent you, or paste it here.",
                                action = "Join with a link",
                            ) { pasting = true }
                        }
                    state.worlds.isEmpty() ->
                        item {
                            EmptyState(
                                title = "No worlds yet",
                                text = "Create a world to start digging, or join a friend's with an invitation link.",
                                action = "Create world",
                            ) { creating = true }
                        }
                    else ->
                        items(state.worlds, key = { it.id }) { entry ->
                            SwipeToInvite(onInvite = { invite(entry.ref) }) {
                                WorldRow(entry) { onPlay(entry.ref) }
                            }
                        }
                }
            }
        }
    }

    if (creating) {
        NewWorldSheet(
            onCreate = { name, seed -> onPlay(model.create(name, seed)) },
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
    if (showingSettings) {
        SettingsSheet(account = account, settings = settings, onSignOut = onSignOut, onDismiss = { showingSettings = false })
    }
}

/** Swipe a row left to invite friends to it; the row springs back. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeToInvite(
    onInvite: () -> Unit,
    content: @Composable () -> Unit,
) {
    val state =
        rememberSwipeToDismissBoxState(
            confirmValueChange = { value ->
                if (value == SwipeToDismissBoxValue.EndToStart) onInvite()
                false
            },
        )
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Row(
                Modifier
                    .fillMaxSize()
                    .clip(CardShape)
                    .background(MerrariaColors.Ink)
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Share, contentDescription = null, tint = MerrariaColors.Surface)
                Spacer(Modifier.width(8.dp))
                Text("Invite", style = Type.body(15, FontWeight.SemiBold, MerrariaColors.Surface))
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
                .background(MerrariaColors.Surface)
                .border(Hairline, MerrariaColors.Line, CardShape)
                .clickable(onClick = onClick)
                .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(MerrariaColors.Sunken),
            contentAlignment = Alignment.Center,
        ) {
            AppMark(30.dp)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(entry.ref.name, style = Type.heading(16), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                MerrariaText.players(maxOf(entry.players, 1)),
                style = Type.body(13, color = MerrariaColors.Muted),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Row(
            Modifier.clip(CircleShape).background(MerrariaColors.Lime).padding(horizontal = 12.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = MerrariaColors.Ink, modifier = Modifier.size(14.dp))
            Text("Play", style = Type.body(13, FontWeight.SemiBold))
        }
    }
}

@Composable
fun EmptyState(
    title: String,
    text: String,
    action: String,
    onAction: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AppMark(64.dp)
        Text(title, style = Type.heading(20))
        Text(text, style = Type.body(15, color = MerrariaColors.Muted), textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 440.dp))
        PrimaryButton(onClick = onAction, fullWidth = false, modifier = Modifier.padding(top = 4.dp)) { ButtonLabel(action) }
    }
}
