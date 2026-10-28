package network.calimero.stream.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.PersonAddAlt
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.stream.app.InvitationLanding
import network.calimero.stream.app.StreamSummary
import network.calimero.stream.app.StreamViewModel
import network.calimero.stream.app.StreamsModel
import network.calimero.stream.core.StreamException
import network.calimero.stream.core.StreamInvitation

/** Your streams (the web's `/streams`): a stream is a space you invite people to; each room in it is one call. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StreamsScreen(
    vm: StreamViewModel,
    model: StreamsModel,
    platform: Platform,
) {
    val streams by model.streams.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val loading by model.isLoading.collectAsState()
    val working by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    val notice by model.notice.collectAsState()
    val scope = rememberCoroutineScope()
    val tap = rememberTap()
    var creating by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    fun invite(stream: StreamSummary) {
        tap()
        scope.launch { model.inviteLink(stream)?.let { platform.share("Invite to ${stream.title}", it) } }
    }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("Streams", fontWeight = FontWeight.SemiBold, fontSize = 17.sp) },
                navigationIcon = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("Join with a link") },
                                leadingIcon = { Icon(Icons.Outlined.Link, contentDescription = null) },
                                onClick = {
                                    menu = false
                                    joining = true
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Sign out", color = Palette.Danger) },
                                leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = Palette.Danger) },
                                onClick = {
                                    menu = false
                                    vm.signOut()
                                },
                            )
                        }
                    }
                },
                actions = {
                    if (model.hasRelay) {
                        IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, contentDescription = "Create stream") }
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Palette.Surface),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading && loaded,
            onRefresh = { scope.launch { model.load() } },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item {
                    Text(
                        buildAnnotatedString {
                            append("A ")
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("stream") }
                            append(" is a space you invite people to. Each ")
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("room") }
                            append(" inside it is one video call.")
                        },
                        fontSize = 15.sp,
                        color = Palette.InkSoft,
                    )
                }
                error?.let { item { NoticeBanner(it, onDismiss = { model.error.value = null }) } }
                notice?.let {
                    item {
                        NoticeBanner(
                            it,
                            onDismiss = { model.notice.value = null },
                            icon = Icons.Outlined.WarningAmber,
                            tint = Palette.Ink,
                            background = Palette.WarnSoft,
                        )
                    }
                }
                if (!loaded) {
                    item { Loading() }
                } else if (streams.isEmpty()) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            EmptyState(
                                Icons.Outlined.Layers,
                                "No streams yet",
                                if (model.hasRelay) {
                                    "Create one to start a call, or open an invitation link someone sent you."
                                } else {
                                    "Your account has no relay yet. Join a stream with an invitation link first."
                                },
                            )
                            if (model.hasRelay) PrimaryButton("Create stream", onClick = { creating = true }, icon = Icons.Filled.Add)
                            SecondaryButton("Join with a link", onClick = { joining = true }, icon = Icons.Outlined.Link)
                        }
                    }
                } else {
                    item { SectionLabel("${streams.size} stream${if (streams.size == 1) "" else "s"}") }
                    items(streams, key = { it.id }) { stream ->
                        SwipeToInvite(onInvite = { invite(stream) }) {
                            StreamRow(stream, onOpen = { vm.openStream(stream) }, onInvite = { invite(stream) })
                        }
                    }
                }
            }
            if (working) BusyOverlay()
        }
    }

    if (creating) {
        NameSheet(
            title = "New stream",
            action = "Create",
            placeholder = "Name a new stream",
            icon = Icons.Outlined.Layers,
            hint = "You can invite people to the whole stream, or straight into one of its rooms.",
            busy = working,
            onDismiss = { creating = false },
        ) { name ->
            scope.launch {
                model.create(name)?.let {
                    creating = false
                    vm.openStream(it)
                }
            }
        }
    }
    if (joining) {
        JoinLinkSheet(model, onDismiss = { joining = false }) { landing ->
            joining = false
            scope.launch {
                vm.didJoin()
                vm.land(landing)
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun StreamRow(
    stream: StreamSummary,
    onOpen: () -> Unit,
    onInvite: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Box {
        Card(Modifier.clip(RoundedCornerShape(14.dp)).combinedClickable(onClick = onOpen, onLongClick = { menu = true })) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                RowIcon(Icons.Outlined.Layers)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        stream.title,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Palette.Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        stream.roomCount?.let { Meta(Icons.Outlined.Tag, "$it room${if (it == 1) "" else "s"}") }
                        Meta(Icons.Outlined.Group, "${stream.memberCount} member${if (stream.memberCount == 1) "" else "s"}")
                    }
                }
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text("Invite to stream") },
                leadingIcon = { Icon(Icons.Outlined.PersonAddAlt, contentDescription = null) },
                onClick = {
                    menu = false
                    onInvite()
                },
            )
        }
    }
}

@Composable
fun Meta(
    icon: ImageVector,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(14.dp))
        Text(text, fontSize = 13.sp, color = Palette.Muted)
    }
}

@Composable
fun SectionLabel(text: String) {
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted, modifier = Modifier.padding(top = 6.dp))
}

@Composable
fun Loading() {
    Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Palette.Ink)
    }
}

@Composable
fun BusyOverlay() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(Modifier.clip(RoundedCornerShape(14.dp)).background(Palette.Surface).padding(18.dp)) {
            CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.size(28.dp))
        }
    }
}

/** A row that offers "Invite" when swiped from the end (the iOS swipe action). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeToInvite(
    onInvite: () -> Unit,
    content: @Composable () -> Unit,
) {
    val state =
        rememberSwipeToDismissBoxState(confirmValueChange = {
            if (it == SwipeToDismissBoxValue.EndToStart) onInvite()
            false
        })
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Box(
                Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Palette.Ink)
                    .padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Outlined.PersonAddAlt, contentDescription = null, tint = Palette.Lime)
                    Text("Invite", color = Palette.Lime, fontWeight = FontWeight.SemiBold)
                }
            }
        },
    ) { content() }
}

/** One text field and an action: naming a new stream or room. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NameSheet(
    title: String,
    action: String,
    placeholder: String,
    icon: ImageVector,
    hint: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val trimmed = name.trim().take(60)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface) {
        Column(Modifier.navigationBarsPadding().imePadding()) {
            SheetBar(title, action, canAct = trimmed.isNotEmpty(), busy = busy, onCancel = onDismiss, onAct = { onSubmit(trimmed) })
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Field(name, { name = it }, placeholder, icon, Modifier.focusRequester(focus), onDone = { if (trimmed.isNotEmpty()) onSubmit(trimmed) })
                Text(hint, fontSize = 14.sp, color = Palette.Muted)
                Spacer(Modifier.size(12.dp))
            }
        }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

/** A rounded text field on the sunken grey. */
@Composable
fun Field(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    capitalize: Boolean = true,
    onDone: () -> Unit = {},
) {
    TextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(placeholder, color = Palette.Muted) },
        leadingIcon = { Icon(icon, contentDescription = null, tint = Palette.Muted) },
        singleLine = true,
        keyboardOptions =
            KeyboardOptions(
                capitalization = if (capitalize) KeyboardCapitalization.Sentences else KeyboardCapitalization.None,
                autoCorrectEnabled = capitalize,
                imeAction = ImeAction.Done,
            ),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        shape = RoundedCornerShape(12.dp),
        colors =
            TextFieldDefaults.colors(
                focusedContainerColor = Palette.Sunken,
                unfocusedContainerColor = Palette.Sunken,
                focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                cursorColor = Palette.Ink,
            ),
        modifier = modifier.fillMaxWidth(),
    )
}

/** Paste an invitation link. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun JoinLinkSheet(
    model: StreamsModel,
    onDismiss: () -> Unit,
    onJoined: (InvitationLanding) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val busy by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    val clipboard = LocalClipboardManager.current
    var text by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }

    fun join() {
        val invitation = StreamInvitation.parse(text)
        if (invitation == null) {
            problem = StreamException.notAnInvitation().message
            return
        }
        problem = null
        scope.launch { model.join(invitation)?.let(onJoined) }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface) {
        Column(Modifier.navigationBarsPadding().imePadding()) {
            SheetBar("Join with a link", "Join", canAct = text.isNotBlank(), busy = busy, onCancel = onDismiss, onAct = ::join)
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Field(text, { text = it }, "Paste an invitation link", Icons.Outlined.Link, capitalize = false, onDone = ::join)
                (problem ?: error)?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Text("A stream link opens its rooms; a room link drops you straight into that call.", fontSize = 14.sp, color = Palette.Muted)
                if (clipboard.hasText()) {
                    SecondaryButton("Paste", onClick = { text = clipboard.getText()?.text.orEmpty() }, compact = true, icon = Icons.Outlined.ContentPaste)
                }
                Spacer(Modifier.size(12.dp))
            }
        }
    }
}
