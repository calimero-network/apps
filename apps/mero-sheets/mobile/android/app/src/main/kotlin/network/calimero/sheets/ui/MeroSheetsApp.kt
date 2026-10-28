@file:Suppress("MatchingDeclarationName")

package network.calimero.sheets.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.sheets.app.SheetsAppViewModel
import network.calimero.sheets.core.LoadPhase
import network.calimero.sheets.core.MeroSheets
import network.calimero.sheets.core.SpreadsheetItem
import network.calimero.sheets.core.WorkspaceModel
import network.calimero.sheets.core.WorkspaceState

enum class AppSheet { NEW_WORKSPACE, NEW_SPREADSHEET, INVITE }

/** Signed out → sign-in; signed in → the app, rebuilt when the session's backend is. */
@Composable
fun MeroSheetsApp(
    vm: SheetsAppViewModel,
    onSignIn: () -> Unit,
    onShare: (String) -> Unit,
) {
    val backend by vm.session.backend.collectAsStateWithLifecycle()
    val restoring by vm.session.isRestoring.collectAsStateWithLifecycle()
    val revision by vm.session.revision.collectAsStateWithLifecycle()
    val pending by vm.session.pendingInvitation.collectAsStateWithLifecycle()
    SheetsTheme {
        Surface(Modifier.fillMaxSize(), color = Palette.ground) {
            val current = backend
            when {
                current != null -> key(revision) { SignedInScreen(current, vm, onShare) }
                restoring -> CenteredProgress()
                else -> SignInScreen(vm, onSignIn)
            }
            val link = pending
            if (link != null && current != null) {
                JoinInvitationSheet(link = link, vm = vm)
            }
        }
    }
}

@Composable
fun SignInScreen(
    vm: SheetsAppViewModel,
    onSignIn: () -> Unit,
) {
    val state by vm.session.client.state
        .collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current
    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Box(Modifier.size(76.dp).clip(RoundedCornerShape(22.dp)).background(Palette.lime), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.TableChart, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(38.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text("Mero Sheets", fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
        Spacer(Modifier.height(18.dp))
        Text(
            "Collaborative spreadsheets, peer to peer. Open your team’s sheets, read the numbers and charts, and update a value on the go.",
            fontSize = 16.sp,
            color = Palette.text2,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Spacer(Modifier.weight(1f))
        val error = state.error
        if (error != null && !state.isLoading) {
            Text(error, fontSize = 14.sp, color = Palette.danger, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
        }
        PrimaryButton(
            if (state.isLoading) "Waiting for the wallet…" else "Sign in with Calimero",
            onClick = {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                onSignIn()
            },
            busy = state.isLoading,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "Your spreadsheets live with your team, not on a server. Sign-in approves this phone with your Calimero account.",
            fontSize = 13.sp,
            color = Palette.text3,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The signed-in app: the Spreadsheets tab (a list that opens each one) and the Workspace tab, over
 * one workspace model.
 */
@Suppress("CyclomaticComplexMethod", "LongMethod")
@Composable
fun SignedInScreen(
    backend: MeroAppBackend,
    vm: SheetsAppViewModel,
    onShare: (String) -> Unit,
) {
    val workspace = remember(backend) { WorkspaceModel(backend, vm.session.applicationId, vm.store) }
    val ws by workspace.state.collectAsStateWithLifecycle()
    val justJoined by vm.justJoined.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(0) }
    var sheet by remember { mutableStateOf<AppSheet?>(null) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    var inviteFor by remember { mutableStateOf<SpreadsheetItem?>(null) }
    var hostingNotice by remember { mutableStateOf<String?>(null) }

    fun openJoined() {
        val joined = vm.justJoined.value ?: return
        val state = workspace.state.value
        if (joined.namespaceId != state.activeWorkspaceId || state.isSyncing) return
        joined.contextId?.let { id -> if (state.spreadsheet(id) != null) open = id }
        vm.clearJustJoined()
    }

    LaunchedEffect(workspace) {
        workspace.markSyncing(vm.justJoined.value?.namespaceId)
        workspace.load()
        openJoined()
    }
    LaunchedEffect(ws.isSyncing) {
        // A just-joined workspace: its spreadsheets arrive with the namespace's data.
        var waited = false
        while (workspace.state.value.isSyncing) {
            waited = true
            delay(MeroSheets.POLL_INTERVAL_MS)
            workspace.loadSpreadsheets()
        }
        if (waited) openJoined()
    }
    LaunchedEffect(justJoined) {
        val joined = justJoined ?: return@LaunchedEffect
        workspace.markSyncing(joined.namespaceId)
        workspace.load()
        workspace.selectWorkspace(joined.namespaceId)
        tab = 0
        open = null
        openJoined()
    }

    Scaffold(
        containerColor = Palette.ground,
        bottomBar = {
            NavigationBar(containerColor = Palette.surface, tonalElevation = 0.dp) {
                val colors =
                    NavigationBarItemDefaults.colors(
                        selectedIconColor = Palette.ink,
                        selectedTextColor = Palette.ink,
                        indicatorColor = Palette.lime,
                        unselectedIconColor = Palette.text3,
                        unselectedTextColor = Palette.text3,
                    )
                listOf(
                    Triple("Spreadsheets", Icons.Outlined.TableChart, 0),
                    Triple("Workspace", Icons.Outlined.Group, 1),
                ).forEach { (label, icon, index) ->
                    NavigationBarItem(
                        selected = tab == index,
                        onClick = { tab = index },
                        icon = { Icon(icon, contentDescription = null) },
                        label = { Text(label) },
                        colors = colors,
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                0 -> {
                    val id = open
                    if (id != null) {
                        BackHandler { open = null }
                        SpreadsheetScreen(workspace, ws, id, onBack = { open = null }) {
                            inviteFor = ws.spreadsheet(id)
                            sheet = AppSheet.INVITE
                        }
                    } else {
                        SpreadsheetsScreen(
                            workspace,
                            ws,
                            openSheet = {
                                inviteFor = null
                                sheet = it
                            },
                            invite = {
                                inviteFor = it
                                sheet = AppSheet.INVITE
                            },
                        ) { open = it }
                    }
                }
                else ->
                    WorkspaceScreen(workspace, ws, {
                        inviteFor = null
                        sheet = it
                    }, vm::signOut) {
                        open = it
                        tab = 0
                    }
            }
        }
    }

    when (sheet) {
        AppSheet.NEW_WORKSPACE ->
            NameSheet(
                title = "New workspace",
                message = "A workspace holds your team’s spreadsheets. Everyone you invite gets all of them.",
                field = "Workspace name",
                placeholder = "e.g. Finance",
                action = "Create workspace",
                onDismiss = { sheet = null },
            ) { name ->
                hostingNotice = workspace.createWorkspace(name)
                open = null
                tab = 0
            }
        AppSheet.NEW_SPREADSHEET ->
            NameSheet(
                title = "New spreadsheet",
                message = "Everyone in ${ws.activeWorkspace?.let { WorkspaceModel.displayName(it) } ?: "the workspace"} can open it.",
                field = "Spreadsheet name",
                placeholder = "e.g. Q3 Budget",
                action = "Create spreadsheet",
                onDismiss = { sheet = null },
            ) { name ->
                val id = workspace.createSpreadsheet(name)
                tab = 0
                open = id
            }
        AppSheet.INVITE -> InviteSheet(workspace, inviteFor, onShare) { sheet = null }
        null -> Unit
    }

    hostingNotice?.let { notice ->
        AlertDialog(
            onDismissRequest = { hostingNotice = null },
            confirmButton = { TextButton(onClick = { hostingNotice = null }) { Text("Got it", color = Palette.ink) } },
            title = { Text("Workspace created") },
            text = { Text("It is ready for you, but an invitation from it will not reach anyone yet: $notice.") },
            containerColor = Palette.surface,
        )
    }
}

/** The open workspace's spreadsheets; the title switches workspaces. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpreadsheetsScreen(
    workspace: WorkspaceModel,
    ws: WorkspaceState,
    openSheet: (AppSheet) -> Unit,
    invite: (SpreadsheetItem) -> Unit,
    open: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        SwitcherBar(workspace, ws, openSheet)
        val phase = ws.phase
        val listPhase = ws.spreadsheetsPhase
        when {
            phase is LoadPhase.Failed ->
                EmptyState(Icons.Outlined.WifiOff, "Could not load your workspaces", phase.message, "Try again" to { scope.launch { workspace.load() } })
            phase == LoadPhase.Loading || phase == LoadPhase.Idle -> CenteredProgress()
            ws.activeWorkspace == null ->
                EmptyState(
                    Icons.Outlined.Group,
                    "No workspace yet",
                    "Create a workspace for your team, or open an invitation link someone sent you.",
                    "New workspace" to { openSheet(AppSheet.NEW_WORKSPACE) },
                )
            ws.isSyncing ->
                EmptyState(Icons.Outlined.Sync, "Syncing this workspace…", "Spreadsheets appear as soon as your teammates’ devices send them.")
            listPhase == LoadPhase.Loading && ws.spreadsheets.isEmpty() -> CenteredProgress()
            listPhase is LoadPhase.Failed && ws.spreadsheets.isEmpty() ->
                EmptyState(
                    Icons.Outlined.WifiOff,
                    "Could not load the spreadsheets",
                    listPhase.message,
                    "Try again" to { scope.launch { workspace.loadSpreadsheets() } },
                )
            ws.spreadsheets.isEmpty() ->
                EmptyState(
                    Icons.Outlined.TableChart,
                    "No spreadsheets yet",
                    "Create the first spreadsheet in this workspace. Everyone in it can open it.",
                    "New spreadsheet" to { openSheet(AppSheet.NEW_SPREADSHEET) },
                )
            else ->
                PullToRefreshBox(
                    isRefreshing = refreshing,
                    onRefresh = {
                        scope.launch {
                            refreshing = true
                            workspace.loadSpreadsheets()
                            refreshing = false
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(Palette.gutter),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(ws.spreadsheets, key = { it.id }) { item ->
                            SpreadsheetRow(item, { invite(item) }) { open(item.id) }
                        }
                        item {
                            Text(
                                "Spreadsheets are shared with everyone in the workspace.",
                                fontSize = 13.sp,
                                color = Palette.text3,
                                modifier = Modifier.padding(start = 4.dp, top = 6.dp),
                            )
                        }
                    }
                }
        }
    }
}

/** One spreadsheet; swipe left to invite people to it. */
@Composable
private fun SpreadsheetRow(
    item: SpreadsheetItem,
    invite: () -> Unit,
    open: () -> Unit,
) {
    val swipe =
        rememberSwipeToDismissBoxState(confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) invite()
            false
        })
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Box(
                Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(Palette.radius))
                    .background(Palette.ink)
                    .padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Outlined.PersonAdd, contentDescription = null, tint = Palette.surface)
                    Text("Invite", color = Palette.surface, fontWeight = FontWeight.SemiBold)
                }
            }
        },
    ) {
        Row(
            Modifier.card(12.dp).clickable(onClick = open),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(11.dp)).background(Palette.lime.copy(alpha = 0.35f)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.TableChart, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(20.dp)) }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                OneLine(item.name, size = 16, weight = FontWeight.SemiBold, color = if (item.unnamed) Palette.text2 else Palette.ink)
                Text(if (item.unnamed) "Name not synced yet" else "Spreadsheet", fontSize = 13.sp, color = Palette.text3)
            }
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.text3)
        }
    }
}

/** "Spreadsheets" over the open workspace's name, with a menu to switch workspaces; and New spreadsheet. */
@Composable
fun SwitcherBar(
    workspace: WorkspaceModel,
    ws: WorkspaceState,
    openSheet: (AppSheet) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    Box(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 8.dp)
            .height(56.dp),
    ) {
        Box(Modifier.align(Alignment.Center)) {
            Column(
                Modifier.clip(RoundedCornerShape(10.dp)).clickable { menu = true }.padding(horizontal = 10.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    OneLine("Spreadsheets", size = 16, weight = FontWeight.SemiBold)
                    Icon(Icons.Outlined.ExpandMore, contentDescription = "Switch workspace", tint = Palette.text3, modifier = Modifier.size(18.dp))
                }
                ws.activeWorkspace?.let { OneLine(WorkspaceModel.displayName(it), size = 11, color = Palette.text3) }
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.surface) {
                Text("Workspaces", fontSize = 12.sp, color = Palette.text3, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                ws.workspaces.forEach { ns ->
                    DropdownMenuItem(
                        text = { Text(WorkspaceModel.displayName(ns)) },
                        onClick = {
                            menu = false
                            scope.launch { workspace.selectWorkspace(ns.id) }
                        },
                        trailingIcon = { if (ns.id == ws.activeWorkspaceId) Icon(Icons.Filled.Check, contentDescription = null) },
                    )
                }
                HorizontalDivider(color = Palette.line)
                DropdownMenuItem(
                    text = { Text("New workspace") },
                    leadingIcon = { Icon(Icons.Outlined.Add, contentDescription = null) },
                    onClick = {
                        menu = false
                        openSheet(AppSheet.NEW_WORKSPACE)
                    },
                )
            }
        }
        if (ws.activeWorkspace != null) {
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 8.dp)
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(Palette.lime)
                    .clickable {
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        openSheet(AppSheet.NEW_SPREADSHEET)
                    },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Add, contentDescription = "New spreadsheet", tint = Palette.ink) }
        }
    }
}
