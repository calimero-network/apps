package network.calimero.issues.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.ViewWeek
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import network.calimero.issues.app.IssuesAppViewModel
import network.calimero.issues.core.IssuesModel
import network.calimero.issues.core.IssuesState
import network.calimero.issues.core.LiveUpdates
import network.calimero.issues.core.LoadPhase
import network.calimero.issues.core.Tracker
import network.calimero.issues.core.WorkspaceModel
import network.calimero.issues.core.WorkspaceState

enum class TrackerSheet { NEW_ISSUE, NEW_WORKSPACE, ADD_REPO, REPO_URL, INVITE, FILTERS }

data class IssueRoute(
    val repoId: String,
    val issueId: String,
)

/** Signed out → sign-in; signed in → the tracker, rebuilt when the session's backend is. */
@Composable
fun IssuesApp(
    vm: IssuesAppViewModel,
    onSignIn: () -> Unit,
    onShare: (String) -> Unit,
) {
    val backend by vm.session.backend.collectAsStateWithLifecycle()
    val restoring by vm.session.isRestoring.collectAsStateWithLifecycle()
    val revision by vm.session.revision.collectAsStateWithLifecycle()
    val pending by vm.session.pendingInvitation.collectAsStateWithLifecycle()
    IssuesTheme {
        Surface(Modifier.fillMaxSize(), color = Palette.ground) {
            val current = backend
            when {
                current != null -> key(revision) { TrackerScreen(current, vm, onShare) }
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
    vm: IssuesAppViewModel,
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
            Icon(Icons.Outlined.Checklist, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(38.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text("Mero Issue Tracker", fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
        Spacer(Modifier.height(18.dp))
        Text(
            "A private, real-time issue board for a small engineering team. Create, triage and discuss issues together.",
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
            "Your board lives with your team, not on a server. Sign-in approves this phone with your Calimero account.",
            fontSize = 13.sp,
            color = Palette.text3,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The signed-in app: Issues, Board and Workspace tabs over one workspace model, and one issues model
 * for the open repo (shared by the list and the board).
 */
@Composable
fun TrackerScreen(
    backend: MeroAppBackend,
    vm: IssuesAppViewModel,
    onShare: (String) -> Unit,
) {
    val workspace = remember(backend) { WorkspaceModel(backend, vm.session.applicationId, vm.store) }
    val ws by workspace.state.collectAsStateWithLifecycle()
    val justJoined by vm.justJoined.collectAsStateWithLifecycle()
    var issues by remember { mutableStateOf<IssuesModel?>(null) }
    var tab by rememberSaveable { mutableStateOf(0) }
    var sheet by remember { mutableStateOf<TrackerSheet?>(null) }
    var issuesRoute by remember { mutableStateOf<IssueRoute?>(null) }
    var boardRoute by remember { mutableStateOf<IssueRoute?>(null) }
    var hostingNotice by remember { mutableStateOf<String?>(null) }
    val issuesFlow = remember(issues) { issues?.state ?: MutableStateFlow(IssuesState()) }
    val shownIssues = issuesFlow.collectAsStateWithLifecycle().value.issues

    LaunchedEffect(workspace) {
        workspace.markSyncing(justJoined)
        workspace.load()
    }
    LaunchedEffect(ws.activeRepoId) {
        val repoId = ws.activeRepoId
        if (repoId == null) {
            issues = null
            return@LaunchedEffect
        }
        val model = IssuesModel(workspace.client(repoId), repoId)
        issues = model
        workspace.ensureMember(repoId)
        model.load()
        LiveUpdates.follow(backend, repoId) { model.load() }
    }
    LaunchedEffect(ws.isSyncing) {
        // A just-joined workspace: its repos arrive with the namespace's data.
        var waited = false
        while (workspace.state.value.isSyncing) {
            waited = true
            delay(Tracker.POLL_INTERVAL_MS)
            workspace.loadRepos()
        }
        if (waited) vm.clearJustJoined()
    }
    LaunchedEffect(justJoined) {
        val id = justJoined ?: return@LaunchedEffect
        workspace.markSyncing(id)
        workspace.load()
        workspace.selectWorkspace(id)
        tab = 0
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
                    Triple("Issues", Icons.AutoMirrored.Filled.List, 0),
                    Triple("Board", Icons.Outlined.ViewWeek, 1),
                    Triple("Workspace", Icons.Outlined.Group, 2),
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
            val repoTitle: @Composable () -> Unit = {
                RepoTopBar(workspace, ws, canCreate = ws.activeRepo != null && issues != null) { sheet = it }
            }
            when (tab) {
                0 -> {
                    val route = issuesRoute
                    if (route != null) {
                        BackHandler { issuesRoute = null }
                        IssueDetailScreen(
                            workspace, ws, route,
                            shownIssues.firstOrNull { it.id == route.issueId },
                            onBack = {
                                issuesRoute = null
                            },
                        ) { issues?.load() }
                    } else {
                        Column {
                            repoTitle()
                            RepoGate(workspace, ws, issues, { sheet = it }) { model ->
                                IssueList(model, { sheet = it }) { issuesRoute = IssueRoute(model.repoId, it) }
                            }
                        }
                    }
                }
                1 -> {
                    val route = boardRoute
                    if (route != null) {
                        BackHandler { boardRoute = null }
                        IssueDetailScreen(
                            workspace, ws, route,
                            shownIssues.firstOrNull { it.id == route.issueId },
                            onBack = {
                                boardRoute = null
                            },
                        ) { issues?.load() }
                    } else {
                        Column {
                            repoTitle()
                            RepoGate(workspace, ws, issues, { sheet = it }) { model ->
                                BoardView(model) { boardRoute = IssueRoute(model.repoId, it) }
                            }
                        }
                    }
                }
                else -> WorkspaceScreen(workspace, ws, { sheet = it }, vm::signOut)
            }
        }
    }

    when (sheet) {
        TrackerSheet.NEW_ISSUE -> issues?.let { NewIssueSheet(it, ws.activeRepo?.name) { sheet = null } }
        TrackerSheet.FILTERS -> issues?.let { FilterSheet(it) { sheet = null } }
        TrackerSheet.NEW_WORKSPACE ->
            NameSheet(
                title = "New workspace",
                message = "Name your team workspace. You will add repositories to it next.",
                field = "Workspace name",
                placeholder = "e.g. Platform team",
                action = "Create workspace",
                onDismiss = { sheet = null },
            ) { name ->
                hostingNotice = workspace.createWorkspace(name)
                tab = 0
            }
        TrackerSheet.ADD_REPO -> AddRepoSheet(workspace, onDismiss = { sheet = null }) { tab = if (tab == 2) 0 else tab }
        TrackerSheet.REPO_URL ->
            NameSheet(
                title = "Repository URL",
                message = "The GitHub repository this repo tracks. Everyone in the workspace sees it.",
                field = "GitHub URL",
                placeholder = "https://github.com/owner/repo",
                action = "Save",
                initial = ws.activeRepo?.url.orEmpty(),
                allowsEmpty = true,
                url = true,
                onDismiss = { sheet = null },
            ) { workspace.setRepoUrl(it) }
        TrackerSheet.INVITE -> InviteSheet(workspace, onShare) { sheet = null }
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

/** The open repo as a title, with a menu to switch repos; and the New issue button. */
@Composable
fun RepoTopBar(
    workspace: WorkspaceModel,
    ws: WorkspaceState,
    canCreate: Boolean,
    openSheet: (TrackerSheet) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
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
                Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = ws.activeWorkspace != null) { menu = true }.padding(horizontal = 10.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    OneLine(ws.activeRepo?.name ?: "Issues", size = 16, weight = FontWeight.SemiBold)
                    if (ws.activeWorkspace != null) Icon(Icons.Outlined.ExpandMore, contentDescription = "Switch repository", tint = Palette.text3, modifier = Modifier.size(18.dp))
                }
                ws.activeWorkspace?.let { OneLine(WorkspaceModel.displayName(it), size = 11, color = Palette.text3) }
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.surface) {
                ws.activeWorkspace?.let {
                    Text(
                        WorkspaceModel.displayName(it),
                        fontSize = 12.sp,
                        color = Palette.text3,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    )
                }
                ws.repos.forEach { repo ->
                    DropdownMenuItem(
                        text = { Text(repo.name) },
                        onClick = {
                            workspace.selectRepo(repo.id)
                            menu = false
                        },
                        trailingIcon = { if (repo.id == ws.activeRepoId) Icon(Icons.Filled.Check, contentDescription = null) },
                    )
                }
                HorizontalDivider(color = Palette.line)
                DropdownMenuItem(
                    text = { Text("Add a repository") },
                    leadingIcon = { Icon(Icons.Outlined.Add, contentDescription = null) },
                    onClick = {
                        menu = false
                        openSheet(TrackerSheet.ADD_REPO)
                    },
                )
            }
        }
        if (canCreate) {
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 8.dp)
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(Palette.lime)
                    .clickable {
                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        openSheet(TrackerSheet.NEW_ISSUE)
                    },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Add, contentDescription = "New issue", tint = Palette.ink) }
        }
    }
}

/** What a tab shows before there are issues to show: no workspace, no repo, syncing, failed. */
@Composable
fun RepoGate(
    workspace: WorkspaceModel,
    ws: WorkspaceState,
    issues: IssuesModel?,
    openSheet: (TrackerSheet) -> Unit,
    content: @Composable (IssuesModel) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val phase = ws.phase
    when {
        phase is LoadPhase.Failed ->
            EmptyState(Icons.Outlined.WifiOff, "Could not load your workspaces", phase.message, "Try again" to { scope.launch { workspace.load() } })
        phase == LoadPhase.Loading || phase == LoadPhase.Idle -> CenteredProgress()
        ws.activeWorkspace == null ->
            EmptyState(
                Icons.Outlined.Group,
                "No workspace yet",
                "Create a workspace for your team, or open an invitation link someone sent you.",
                "New workspace" to { openSheet(TrackerSheet.NEW_WORKSPACE) },
            )
        ws.isSyncing ->
            EmptyState(Icons.Outlined.Sync, "Syncing this workspace…", "Repositories and issues appear as soon as your teammates’ devices send them.")
        ws.reposPhase == LoadPhase.Loading && ws.repos.isEmpty() -> CenteredProgress()
        ws.activeRepo == null ->
            EmptyState(
                Icons.Outlined.Code,
                "No repository yet",
                "Add a repository to this workspace to start tracking its issues.",
                "Add a repository" to { openSheet(TrackerSheet.ADD_REPO) },
            )
        issues != null -> content(issues)
        else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.ink) }
    }
}
