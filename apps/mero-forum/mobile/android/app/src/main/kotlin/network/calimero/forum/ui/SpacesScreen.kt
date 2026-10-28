package network.calimero.forum.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.PortableWifiOff
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.AppNamespace
import kotlinx.coroutines.launch
import network.calimero.forum.ForumViewModel
import network.calimero.forum.core.ForumErrorText
import network.calimero.forum.core.ForumFormat
import network.calimero.forum.core.ForumInvitation
import network.calimero.forum.core.LoadPhase
import network.calimero.forum.core.SpacesModel

private enum class SpacesSheet { NEW_SPACE, JOIN, PROFILE }

/** Your spaces. A space holds forums and is what you invite people to. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpacesScreen(
    model: SpacesModel,
    vm: ForumViewModel,
    open: (AppNamespace) -> Unit,
    openInvitation: (String) -> Unit,
) {
    val spaces by model.spaces.collectAsState()
    val phase by model.phase.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<SpacesSheet?>(null) }
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            ForumTopBar(
                title = "Spaces",
                navigation = {
                    IconButton(onClick = { sheet = SpacesSheet.PROFILE }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.Add, contentDescription = "Add a space") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.Surface) {
                            DropdownMenuItem(
                                text = { Text("New space") },
                                leadingIcon = { Icon(Icons.Filled.Add, null) },
                                onClick = {
                                    menu = false
                                    sheet = SpacesSheet.NEW_SPACE
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Join with a link") },
                                leadingIcon = { Icon(Icons.Outlined.Link, null) },
                                onClick = {
                                    menu = false
                                    sheet = SpacesSheet.JOIN
                                },
                            )
                        }
                    }
                },
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
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                if (!model.hasRelay) {
                    item {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(Palette.LimeSoft)
                                .padding(14.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Icon(Icons.Outlined.PortableWifiOff, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(10.dp))
                            Text("Your account has no relay yet. Join a space from an invitation link to get one.", fontSize = 14.sp, color = Palette.Ink)
                        }
                    }
                }
                when (val p = phase) {
                    LoadPhase.Loading -> items(3) { SkeletonCard() }
                    is LoadPhase.Failed -> item { ErrorState(p.message) { scope.launch { model.load() } } }
                    LoadPhase.Loaded ->
                        if (spaces.isEmpty()) {
                            item {
                                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                                    EmptyState(
                                        Icons.Outlined.Layers,
                                        "No spaces yet",
                                        "Create a space for your community, or join one from an invitation link.",
                                        "New space",
                                    ) { sheet = SpacesSheet.NEW_SPACE }
                                    SecondaryButton("Join with a link", { sheet = SpacesSheet.JOIN }, compact = true)
                                }
                            }
                        } else {
                            items(spaces, key = { it.id }) { space -> SpaceCard(space) { open(space) } }
                        }
                }
            }
        }
    }

    when (sheet) {
        SpacesSheet.NEW_SPACE ->
            NameSheet(
                title = "New space",
                placeholder = "Space name",
                action = "Create",
                note = "A space holds forums. You can invite people to it once it exists.",
                dismiss = { sheet = null },
            ) { name -> model.create(name) }
        SpacesSheet.JOIN ->
            JoinSheet(dismiss = { sheet = null }) { link ->
                sheet = null
                openInvitation(link)
            }
        SpacesSheet.PROFILE -> ProfileSheet(vm) { sheet = null }
        null -> Unit
    }
}

/** The bar every screen shares: white, centred title, ink. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForumTopBar(
    title: String,
    subtitle: String? = null,
    navigation: @Composable () -> Unit = {},
    actions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
) {
    Column {
        CenterAlignedTopAppBar(
            title = {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = Palette.Muted, maxLines = 1)
                }
            },
            navigationIcon = navigation,
            actions = actions,
            colors =
                TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = Palette.Surface,
                    titleContentColor = Palette.Ink,
                    navigationIconContentColor = Palette.Ink,
                    actionIconContentColor = Palette.Ink,
                ),
        )
        Hairline()
    }
}

@Composable
fun BackButton(back: () -> Unit) {
    IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
}

@Composable
private fun SpaceCard(
    space: AppNamespace,
    onClick: () -> Unit,
) {
    Card(onClick = onClick) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(SpacesModel.nameOf(space), seed = space.id, size = 46.dp, square = true)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(SpacesModel.nameOf(space), fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Palette.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (space.memberCount > 0) ForumFormat.count(space.memberCount, "member", "members") else "Space",
                    fontSize = 14.sp,
                    color = Palette.Muted,
                )
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
        }
    }
}

@Composable
fun SkeletonCard() {
    Card {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Skeleton(46.dp, 46.dp, RoundedCornerShape(12.dp))
            Column(Modifier.padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Skeleton(140.dp, 14.dp)
                Skeleton(80.dp, 10.dp)
            }
        }
    }
}

@Composable
fun plainFieldColors() =
    TextFieldDefaults.colors(
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        focusedIndicatorColor = Color.Transparent,
        unfocusedIndicatorColor = Color.Transparent,
        cursorColor = Palette.Ink,
    )

@Composable
fun filledFieldColors() =
    TextFieldDefaults.colors(
        focusedContainerColor = Palette.Sunken,
        unfocusedContainerColor = Palette.Sunken,
        focusedIndicatorColor = Color.Transparent,
        unfocusedIndicatorColor = Color.Transparent,
        cursorColor = Palette.Ink,
    )

/** One name in, one async action out: new space, new forum. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NameSheet(
    title: String,
    placeholder: String,
    action: String,
    note: String,
    dismiss: () -> Unit,
    submit: suspend (String) -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }

    fun run() {
        if (busy || name.isBlank()) return
        busy = true
        error = null
        scope.launch {
            runCatching { submit(name) }
                .onSuccess {
                    state.hide()
                    dismiss()
                }.onFailure { error = ForumErrorText.describe(it) }
            busy = false
        }
    }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = state, containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding()) {
            SheetBar(title, action, canAct = name.isNotBlank(), busy = busy, cancel = dismiss, act = ::run)
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextField(
                    value = name,
                    onValueChange = { name = it },
                    placeholder = { Text(placeholder, fontFamily = Display, fontSize = 22.sp, color = Palette.Muted) },
                    textStyle = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Palette.Ink),
                    singleLine = true,
                    colors = plainFieldColors(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { run() }),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
                Hairline()
                Text(note, fontSize = 14.sp, color = Palette.Muted)
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

/** Paste an invitation link (or code) somebody sent you. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun JoinSheet(
    dismiss: () -> Unit,
    join: (String) -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    var link by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val clip = clipboard.getText()?.text?.takeIf { ForumInvitation.parse(it) != null }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding()) {
            SheetBar("Join with a link", "Continue", canAct = link.isNotBlank(), busy = false, cancel = dismiss, act = {
                if (ForumInvitation.parse(link) == null) error = "This isn't a Mero Forum invitation. Check the link and try again." else join(link)
            })
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextField(
                    value = link,
                    onValueChange = { link = it },
                    placeholder = { Text("Paste an invitation link") },
                    minLines = 3,
                    maxLines = 6,
                    colors = filledFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (clip != null && link.isEmpty()) {
                    SecondaryButton("Paste from clipboard", { link = clip }, compact = true, icon = Icons.Outlined.ContentPaste)
                }
                Text("Links look like links.calimero.network/com.calimero.mero-forum/join?invitation=…", fontSize = 13.sp, color = Palette.Muted)
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/** Who you are, and the way out. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProfileSheet(
    vm: ForumViewModel,
    dismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val name = vm.names.name
    val account = vm.session.account.orEmpty()
    ModalBottomSheet(onDismissRequest = dismiss, containerColor = Palette.Surface) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(name.ifEmpty { "You" }, seed = account.ifEmpty { "you" }, size = 52.dp)
                Column(Modifier.padding(start = 14.dp)) {
                    Text(name.ifEmpty { "No name yet" }, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Palette.Ink)
                    Text(ForumFormat.handle(account), fontSize = 14.sp, color = Palette.Muted)
                }
            }
            Text("You set the name you post under inside each forum, from its info page.", fontSize = 13.sp, color = Palette.Muted)
            Hairline()
            DetailsDisclosure(listOf("Account" to account, "Application" to vm.session.applicationId.orEmpty()))
            Hairline()
            TextButton(onClick = {
                scope.launch {
                    vm.session.signOut()
                    dismiss()
                }
            }) {
                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = Palette.Danger)
                Spacer(Modifier.width(8.dp))
                Text("Sign out", color = Palette.Danger, fontSize = 16.sp)
            }
        }
    }
}
