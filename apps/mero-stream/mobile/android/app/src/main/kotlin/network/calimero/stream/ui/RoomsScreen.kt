package network.calimero.stream.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.PersonAddAlt
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.stream.app.CallTarget
import network.calimero.stream.app.RoomSummary
import network.calimero.stream.app.RoomsModel
import network.calimero.stream.app.StreamSummary
import network.calimero.stream.app.StreamViewModel
import network.calimero.stream.core.People
import network.calimero.stream.generated.Member

/** One stream's rooms (the web's `/streams/:id`). Each room is one video call. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomsScreen(
    vm: StreamViewModel,
    stream: StreamSummary,
    backend: MeroAppBackend,
    platform: Platform,
) {
    val model = remember(stream.id, backend) { RoomsModel(stream, backend, vm.session.applicationId) }
    val rooms by model.rooms.collectAsState()
    val rosters by model.rosters.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val pending by model.pending.collectAsState()
    val status by model.status.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    val tap = rememberTap()
    var creating by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    fun open(room: RoomSummary) {
        val contextId = room.contextId ?: return
        vm.openCall(CallTarget(stream, room, contextId))
    }

    fun enter(room: RoomSummary) {
        tap()
        scope.launch { model.enter(room)?.let(::open) }
    }

    fun invite(room: RoomSummary) {
        tap()
        scope.launch { model.inviteLink(room)?.let { platform.share("Invite to ${room.title}", it) } }
    }

    LaunchedEffect(model) {
        model.load()
        val auto = vm.autoEnter.value
        if (auto != null && auto.namespaceId == stream.id) {
            vm.autoEnter.value = null
            enter(rooms.firstOrNull { it.id == auto.id } ?: auto)
        }
    }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stream.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = { vm.openStream(null) }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Streams") }
                },
                actions = {
                    IconButton(enabled = pending == null, onClick = {
                        tap()
                        scope.launch { model.streamInviteLink()?.let { platform.share("Invite to ${stream.title}", it) } }
                    }) { Icon(Icons.Outlined.PersonAddAlt, contentDescription = "Invite to stream") }
                    IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, contentDescription = "Create room") }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Palette.Surface),
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
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                item {
                    Text(
                        buildAnnotatedString {
                            append("Each ")
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("room") }
                            append(" is one video call. Everyone invited to this stream can join any room in it; a room link drops them straight into that call.")
                        },
                        fontSize = 15.sp,
                        color = Palette.InkSoft,
                    )
                }
                error?.let { item { NoticeBanner(it, onDismiss = { model.error.value = null }) } }
                status?.let {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            CircularProgressIndicator(Modifier.size(18.dp), color = Palette.Ink, strokeWidth = 2.dp)
                            Text(it, fontSize = 14.sp, color = Palette.InkSoft)
                        }
                    }
                }
                if (!loaded) {
                    item { Loading() }
                } else if (rooms.isEmpty()) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            EmptyState(
                                Icons.Outlined.Videocam,
                                "No rooms yet",
                                "Create a room to start a call. If you just joined, rooms appear as the stream syncs; pull to refresh.",
                            )
                            PrimaryButton("Create room", onClick = { creating = true }, icon = Icons.Filled.Add)
                        }
                    }
                } else {
                    item { SectionLabel("${rooms.size} room${if (rooms.size == 1) "" else "s"}") }
                    items(rooms, key = { it.id }) { room ->
                        SwipeToInvite(onInvite = { invite(room) }) {
                            RoomRow(
                                room,
                                roster = room.contextId?.let { rosters[it] },
                                busy = pending == "enter:${room.id}",
                                onJoin = { enter(room) },
                                onInvite = { invite(room) },
                            )
                        }
                    }
                }
                item { DetailsDisclosure(listOf("Stream ID" to stream.id), platform.copy) }
            }
        }
    }

    if (creating) {
        NameSheet(
            title = "New room",
            action = "Create",
            placeholder = "Name a new room",
            icon = Icons.Outlined.Tag,
            hint = "A room is one video call. Everyone in this stream can join it.",
            busy = pending == "create",
            onDismiss = { creating = false },
        ) { name ->
            scope.launch {
                model.create(name)?.let {
                    creating = false
                    open(it)
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RoomRow(
    room: RoomSummary,
    roster: List<Member>?,
    busy: Boolean,
    onJoin: () -> Unit,
    onInvite: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Box {
        Card(Modifier.clip(RoundedCornerShape(14.dp)).combinedClickable(onClick = onJoin, onLongClick = { menu = true })) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                RowIcon(Icons.Outlined.Videocam)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(room.title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (!roster.isNullOrEmpty()) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val shown = roster.take(4)
                            Box(Modifier.width((24 + 16 * (shown.size - 1)).dp)) {
                                shown.forEachIndexed { index, member ->
                                    Box(Modifier.offset(x = (16 * index).dp).border(2.dp, Palette.Surface, CircleShape)) {
                                        Avatar(member.username.ifEmpty { member.memberId }, seed = member.memberId, size = 24)
                                    }
                                }
                            }
                            Text(rosterLine(roster), fontSize = 13.sp, color = Palette.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    } else {
                        Text(if (room.contextId == null) "Still syncing" else "No one has joined yet", fontSize = 13.sp, color = Palette.Muted)
                    }
                }
                PrimaryButton("Join", onClick = onJoin, compact = true, busy = busy, enabled = room.contextId != null)
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text("Invite to this room") },
                leadingIcon = { Icon(Icons.Outlined.PersonAddAlt, contentDescription = null) },
                onClick = {
                    menu = false
                    onInvite()
                },
            )
        }
    }
}

private fun rosterLine(roster: List<Member>): String {
    val names = roster.map { it.username.ifEmpty { People.shortId(it.memberId) } }
    return if (names.size <= 2) names.joinToString(", ") else "${names[0]}, ${names[1]} and ${names.size - 2} more"
}
