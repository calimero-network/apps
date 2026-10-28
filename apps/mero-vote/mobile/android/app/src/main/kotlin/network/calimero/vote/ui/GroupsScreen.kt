package network.calimero.vote.ui

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Ballot
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Person
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.vote.VoteViewModel
import network.calimero.vote.core.GroupRef
import network.calimero.vote.core.GroupRow
import network.calimero.vote.core.GroupsModel
import network.calimero.vote.core.LoadPhase
import network.calimero.vote.core.VoteErrorText
import network.calimero.vote.core.VoteFormat
import network.calimero.vote.core.VoteInvitation
import network.calimero.vote.core.WorkspaceSection

private enum class GroupsSheet { NEW_WORKSPACE, JOIN, ACCOUNT }

/** Every workspace you are in, and the voting groups in each. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupsScreen(
    model: GroupsModel,
    vm: VoteViewModel,
    open: (GroupRef) -> Unit,
    openInvitation: (String) -> Unit,
) {
    val sections by model.sections.collectAsState()
    val phase by model.phase.collectAsState()
    val creating by model.isCreating.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<GroupsSheet?>(null) }
    var menu by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(model) { model.load() }

    fun newGroup(section: WorkspaceSection) {
        scope.launch {
            runCatching { model.createGroup(section) }
                .onSuccess(open)
                .onFailure { notice = VoteErrorText.describe(it) }
        }
    }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            VoteTopBar(
                title = "Voting groups",
                navigation = {
                    IconButton(onClick = { sheet = GroupsSheet.ACCOUNT }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.Add, contentDescription = "Add") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.Surface) {
                            DropdownMenuItem(
                                text = { Text("New workspace") },
                                leadingIcon = { Icon(Icons.Outlined.Layers, null) },
                                onClick = {
                                    menu = false
                                    sheet = GroupsSheet.NEW_WORKSPACE
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Join with a link") },
                                leadingIcon = { Icon(Icons.Outlined.Link, null) },
                                onClick = {
                                    menu = false
                                    sheet = GroupsSheet.JOIN
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
                item { NoticeBanner(notice) { notice = null } }
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
                            Icon(Icons.Outlined.CloudOff, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(10.dp))
                            Text(
                                "Your account has no relay yet. Join a voting group from an invitation link to get one.",
                                fontSize = 14.sp,
                                color = Palette.Ink,
                            )
                        }
                    }
                }
                when (val p = phase) {
                    LoadPhase.Loading -> items(3) { SkeletonCard() }
                    is LoadPhase.Failed -> item { ErrorState(p.message) { scope.launch { model.load() } } }
                    LoadPhase.Loaded ->
                        if (sections.isEmpty()) {
                            item {
                                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                                    EmptyState(
                                        Icons.Outlined.Layers,
                                        "No voting groups yet",
                                        "Create a workspace for your group, or join one from an invitation link.",
                                        "New workspace",
                                    ) { sheet = GroupsSheet.NEW_WORKSPACE }
                                    SecondaryButton("Join with a link", { sheet = GroupsSheet.JOIN }, compact = true)
                                }
                            }
                        } else {
                            sections.forEach { section ->
                                item(key = "head-${section.namespace.id}") {
                                    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            section.name,
                                            fontFamily = Display,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 18.sp,
                                            color = Palette.Ink,
                                            modifier = Modifier.weight(1f),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        TextButton(onClick = { newGroup(section) }, enabled = !creating) {
                                            Icon(Icons.Filled.Add, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.width(4.dp))
                                            Text("New group", color = Palette.Ink, fontWeight = FontWeight.SemiBold)
                                        }
                                    }
                                }
                                if (section.groups.isEmpty()) {
                                    item(key = "empty-${section.namespace.id}") {
                                        Text("No voting groups in this workspace yet.", fontSize = 14.sp, color = Palette.Muted)
                                    }
                                } else {
                                    items(section.groups, key = { it.ref.contextId }) { row -> GroupCard(row) { open(row.ref) } }
                                }
                            }
                        }
                }
            }
        }
    }

    when (sheet) {
        GroupsSheet.NEW_WORKSPACE ->
            NameSheet(
                title = "New workspace",
                placeholder = "Workspace name",
                action = "Create",
                note = "A workspace holds voting groups. The first group is created with it, and you can invite people to it right away.",
                dismiss = { sheet = null },
            ) { name -> open(model.createWorkspace(name)) }
        GroupsSheet.JOIN ->
            JoinSheet(dismiss = { sheet = null }) { link ->
                sheet = null
                openInvitation(link)
            }
        GroupsSheet.ACCOUNT -> AccountSheet(vm) { sheet = null }
        null -> Unit
    }
}

@Composable
private fun GroupCard(
    row: GroupRow,
    onClick: () -> Unit,
) {
    Card(onClick = onClick) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar("Voting group", seed = row.ref.contextId, size = 46.dp, square = true, icon = Icons.Outlined.Ballot)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(
                    row.latest ?: "No polls yet",
                    fontFamily = Display,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = Palette.Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    row.polls?.let { "${VoteFormat.count(it, "poll", "polls")} · ${row.open} open" } ?: "Voting group",
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
    val clip = clipboard.getText()?.text?.takeIf { VoteInvitation.parse(it) != null }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding()) {
            SheetBar("Join with a link", "Continue", canAct = link.isNotBlank(), busy = false, cancel = dismiss, act = {
                if (VoteInvitation.parse(link) == null) error = "This isn't a Mero Vote invitation. Check the link and try again." else join(link)
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
                Text("Links look like links.calimero.network/com.calimero.mero-vote/join?invitation=…", fontSize = 13.sp, color = Palette.Muted)
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/** Who you are, and the way out. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountSheet(
    vm: VoteViewModel,
    dismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val account = vm.session.account.orEmpty()
    ModalBottomSheet(onDismissRequest = dismiss, containerColor = Palette.Surface) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar("You", seed = account.ifEmpty { "you" }, size = 52.dp, icon = Icons.Outlined.Person)
                Column(Modifier.padding(start = 14.dp)) {
                    Text("Your account", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Palette.Ink)
                    Text(VoteFormat.short(account), fontSize = 14.sp, fontFamily = FontFamily.Monospace, color = Palette.Muted)
                }
            }
            Text("You set the name others see inside each voting group, from its Members page.", fontSize = 13.sp, color = Palette.Muted)
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
