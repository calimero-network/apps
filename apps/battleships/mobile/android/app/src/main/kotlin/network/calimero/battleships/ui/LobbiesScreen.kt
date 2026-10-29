package network.calimero.battleships.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.AppNamespace
import kotlinx.coroutines.launch
import network.calimero.battleships.BattleshipsViewModel
import network.calimero.battleships.core.ErrorText
import network.calimero.battleships.core.LoadPhase
import network.calimero.battleships.core.LobbiesModel
import network.calimero.battleships.core.Names

/** Every lobby this account is in, founding a new one, and joining one from a link. */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbiesScreen(
    model: LobbiesModel,
    vm: BattleshipsViewModel,
    open: (AppNamespace) -> Unit,
    openInvitation: (String) -> Unit,
) {
    val lobbies by model.lobbies.collectAsState()
    val phase by model.phase.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var account by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }

    LaunchedEffect(model) { model.load() }

    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        Column(Modifier.statusBarsPadding().padding(horizontal = 16.dp).padding(top = 4.dp, bottom = 8.dp)) {
            Row(Modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
                Box {
                    IconButton(onClick = { account = true }) {
                        Icon(Icons.Outlined.AccountCircle, contentDescription = "Account", tint = Palette.Ink)
                    }
                    DropdownMenu(expanded = account, onDismissRequest = { account = false }) {
                        vm.session.account?.let {
                            DropdownMenuItem(text = { Text("Signed in as ${Names.short(it)}", color = Palette.Muted) }, onClick = {}, enabled = false)
                        }
                        DropdownMenuItem(
                            text = { Text("Sign out", color = Palette.Danger) },
                            leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = Palette.Danger) },
                            onClick = {
                                account = false
                                confirmSignOut = true
                            },
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                Box {
                    IconButton(onClick = { menu = true }) {
                        Box(Modifier.size(34.dp).clip(CircleShape).background(Palette.Lime), contentAlignment = Alignment.Center) {
                            Icon(Icons.Filled.Add, contentDescription = "New lobby", tint = Palette.Ink)
                        }
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text("New lobby") },
                            leadingIcon = { Icon(Icons.Outlined.AddBox, contentDescription = null) },
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
                                joining = true
                            },
                        )
                    }
                }
            }
            Text("Battleships", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 32.sp, color = Palette.Ink)
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            when {
                phase == LoadPhase.Loading && lobbies.isEmpty() ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.Ink) }
                phase is LoadPhase.Failed ->
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 60.dp)) {
                        ErrorState((phase as LoadPhase.Failed).message) { scope.launch { model.load() } }
                    }
                lobbies.isEmpty() ->
                    Column(
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        EmptyState(
                            Icons.Outlined.Groups,
                            "No lobbies yet",
                            "A lobby is where you and your friends challenge each other. Start one, or open an invitation link.",
                            "New lobby",
                        ) { creating = true }
                        SecondaryButton("Join with a link", { joining = true }, compact = true)
                    }
                else ->
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding =
                            androidx.compose.foundation.layout
                                .PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(lobbies, key = { it.id }) { lobby -> LobbyRow(lobby) { open(lobby) } }
                    }
            }
        }
    }

    if (creating) CreateLobbySheet(model, close = { creating = false }) { lobby -> open(lobby) }
    if (joining) {
        JoinLinkSheet(close = { joining = false }) {
            joining = false
            openInvitation(it)
        }
    }
    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("Sign out of Battleships?") },
            text = { Text("Boards you placed stay on this phone, so you can pick your matches up again.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmSignOut = false
                    scope.launch { vm.session.signOut() }
                }) { Text("Sign out", color = Palette.Danger) }
            },
            dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text("Cancel", color = Palette.Ink) } },
            containerColor = Palette.Surface,
        )
    }
}

@Composable
private fun LobbyRow(
    lobby: AppNamespace,
    onClick: () -> Unit,
) {
    Card(padding = 14.dp, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SymbolTile(Icons.Filled.Groups, size = 44.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    Names.lobby(lobby),
                    fontFamily = Display,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = Palette.Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val count = lobby.memberCount
                Text(
                    when {
                        count == 1 -> "1 player"
                        count > 1 -> "$count players"
                        else -> "Lobby"
                    },
                    fontSize = 14.sp,
                    color = Palette.Muted,
                )
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateLobbySheet(
    model: LobbiesModel,
    close: () -> Unit,
    created: (AppNamespace) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    fun create() {
        if (busy || name.isBlank()) return
        busy = true
        error = null
        scope.launch {
            try {
                val lobby = model.create(name)
                close()
                created(lobby)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                error = ErrorText.describe(e, "Couldn't create the lobby. Try again.")
            }
            busy = false
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!busy) close() }, sheetState = sheet, containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding().navigationBarsPadding()) {
            SheetBar("New lobby", "Create", name.isNotBlank(), busy, cancel = close, act = ::create)
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionLabel("Name")
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    placeholder = { Text("Friday night fleet") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { create() }),
                    shape = RoundedCornerShape(12.dp),
                    colors = fieldColors(),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
                Text("You can invite players once it's created.", fontSize = 14.sp, color = Palette.Muted)
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

/** Paste an invitation link someone sent. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun JoinLinkSheet(
    close: () -> Unit,
    submit: (String) -> Unit,
) {
    var raw by remember { mutableStateOf("") }
    val context = LocalContext.current
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = close, sheetState = sheet, containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding().navigationBarsPadding()) {
            SheetBar("Join a lobby", "Continue", raw.isNotBlank(), false, cancel = close, act = { submit(raw) })
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionLabel("Invitation link")
                OutlinedTextField(
                    value = raw,
                    onValueChange = { raw = it },
                    placeholder = { Text("https://links.calimero.network/…") },
                    minLines = 3,
                    maxLines = 6,
                    textStyle =
                        androidx.compose.ui.text
                            .TextStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp),
                    shape = RoundedCornerShape(12.dp),
                    colors = fieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                SecondaryButton("Paste", {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    raw =
                        clipboard.primaryClip
                            ?.getItemAt(0)
                            ?.coerceToText(context)
                            ?.toString()
                            .orEmpty()
                }, compact = true, icon = Icons.Outlined.ContentPaste)
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
fun fieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedContainerColor = Palette.Sunken,
        unfocusedContainerColor = Palette.Sunken,
        focusedBorderColor = Palette.Ink,
        unfocusedBorderColor = Palette.Hairline,
        cursorColor = Palette.Ink,
    )
