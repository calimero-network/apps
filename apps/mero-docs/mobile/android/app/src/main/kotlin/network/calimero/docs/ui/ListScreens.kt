package network.calimero.docs.ui

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.docs.app.DocRow
import network.calimero.docs.app.Folder
import network.calimero.docs.app.FolderIssue
import network.calimero.docs.app.LoadState
import network.calimero.docs.app.Workspace
import network.calimero.docs.app.WorkspaceModel
import network.calimero.docs.app.WorkspacesModel
import network.calimero.docs.core.DocTarget
import network.calimero.docs.core.DocsFormat

private const val SEARCH_DEBOUNCE_MS = 300L

/** The workspaces this account is in. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspacesScreen(
    backend: MeroAppBackend,
    session: MeroAppSession,
    onSignOut: () -> Unit,
    onOpen: (Workspace) -> Unit,
) {
    val model = remember(backend) { WorkspacesModel(backend) }
    val workspaces by model.workspaces.collectAsState()
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showAccount by remember { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = DocsTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Mero Docs", fontWeight = FontWeight.SemiBold) },
                actions = {
                    IconButton(onClick = { showAccount = true }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = DocsTheme.ground, scrolledContainerColor = DocsTheme.ground),
                scrollBehavior = scroll,
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
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                val s = state
                when {
                    s is LoadState.Idle || (s is LoadState.Loading && workspaces.isEmpty()) -> item { LoadingRows() }
                    s is LoadState.Failed && workspaces.isEmpty() -> item { ErrorState(s.message) { scope.launch { model.load() } } }
                    workspaces.isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.Layers,
                                "No workspaces yet",
                                "Create a workspace in Mero Docs on the web or desktop, or accept an invitation there. It shows up here.",
                            )
                        }
                    else -> {
                        item { SectionLabel("Workspaces") }
                        items(workspaces, key = { it.id }) { ws -> WorkspaceRow(ws) { onOpen(ws) } }
                    }
                }
            }
        }
    }

    if (showAccount) AccountSheet(session = session, onDismiss = { showAccount = false }, onSignOut = onSignOut)
}

@Composable
private fun WorkspaceRow(
    workspace: Workspace,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .padding(vertical = 6.dp)
            .fillMaxWidth()
            .clip(DocsTheme.cardShape)
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val color = DocsTheme.memberColor(workspace.id)
        Box(Modifier.size(44.dp).background(color.copy(alpha = 0.14f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Text(DocsFormat.initials(workspace.name), style = DocsTheme.body(16, FontWeight.SemiBold, color))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(workspace.name, style = DocsTheme.heading(17), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (workspace.memberCount == 1) "1 member" else "${workspace.memberCount} members",
                style = DocsTheme.body(14, color = DocsTheme.muted),
            )
        }
    }
}

/** Who is signed in, and signing out. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountSheet(
    session: MeroAppSession,
    onDismiss: () -> Unit,
    onSignOut: () -> Unit,
) {
    var confirm by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = DocsTheme.ground) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Text("Account", style = DocsTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Row(Modifier.fillMaxWidth().card(), verticalAlignment = Alignment.CenterVertically) {
                Avatar(session.account.orEmpty(), "Me", 44.dp)
                Spacer(Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Signed in", style = DocsTheme.heading(17))
                    Text(
                        if (session.hasRelay) "Connected through your relay" else "No relay serves this account yet",
                        style = DocsTheme.body(14, color = DocsTheme.muted),
                    )
                }
            }
            DetailsDisclosure(
                listOf("Account" to (session.account ?: "—"), "Application" to (session.applicationId ?: "—")),
                Modifier.fillMaxWidth().card(),
            )
            SecondaryButton(onClick = { confirm = true }) {
                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = DocsTheme.danger, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Sign out", color = DocsTheme.danger)
            }
            Spacer(Modifier.size(8.dp))
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out of Mero Docs?") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    onDismiss()
                    onSignOut()
                }) { Text("Sign out", color = DocsTheme.danger) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

/**
 * A workspace's home: search, what this phone opened last, folders, and everything by last change
 * (the web's Home table).
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceScreen(
    model: WorkspaceModel,
    onBack: () -> Unit,
    onOpenFolder: (Folder) -> Unit,
    onOpenDoc: (DocRow) -> Unit,
) {
    val folders by model.folders.collectAsState()
    val docs by model.docs.collectAsState()
    val issues by model.issues.collectAsState()
    val state by model.state.collectAsState()
    val query by model.query.collectAsState()
    val results by model.results.collectAsState()
    val searching by model.searching.collectAsState()
    var text by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var refreshing by remember { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { model.load() }
    LaunchedEffect(text) {
        if (text.isNotBlank()) delay(SEARCH_DEBOUNCE_MS)
        model.search(text)
    }
    val share = { row: DocRow -> shareLink(context, DocsFormat.docLink(DocTarget(model.workspace.id, row.folderId, row.doc.id)), row.title) }

    Scaffold(
        containerColor = DocsTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(model.workspace.name.ifEmpty { "Workspace" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = DocsTheme.ground, scrolledContainerColor = DocsTheme.ground),
                scrollBehavior = scroll,
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
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                item { SearchField(text, onChange = { text = it }) }
                val s = state
                when {
                    query.isNotEmpty() -> {
                        item {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                SectionLabel("Results", Modifier.weight(1f))
                                if (searching) CircularProgressIndicator(color = DocsTheme.muted, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
                            }
                        }
                        if (results.isEmpty() && !searching) {
                            item { EmptyState(Icons.Outlined.Search, "No matches", "Nothing in this workspace matches “$query”.") }
                        }
                        items(results, key = { "r:" + it.row.id }) { r ->
                            SwipeToShare(onShare = { share(r.row) }) { DocRowView(r.row, showFolder = true, snippet = r.snippet) { onOpenDoc(r.row) } }
                        }
                    }
                    s is LoadState.Idle || (s is LoadState.Loading && folders.isEmpty()) -> item { LoadingRows() }
                    s is LoadState.Failed && folders.isEmpty() -> item { ErrorState(s.message) { scope.launch { model.load() } } }
                    model.folders(null).isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.Folder,
                                "No folders yet",
                                "Folders are created in Mero Docs on the web or desktop. Pull to refresh once one exists.",
                            )
                        }
                    else -> {
                        val recent = model.recent
                        if (recent.isNotEmpty()) {
                            item { SectionLabel("Recent") }
                            items(recent, key = { "recent:" + it.id }) { row ->
                                SwipeToShare(onShare = { share(row) }) { DocRowView(row, showFolder = true) { onOpenDoc(row) } }
                            }
                        }
                        item { SectionLabel("Folders") }
                        items(model.folders(null), key = { "f:" + it.id }) { f -> FolderRow(model, f, issues[f.id], docs) { onOpenFolder(f) } }
                        item { SectionLabel("Recently updated") }
                        val all = model.recentlyUpdated
                        if (all.isEmpty()) {
                            item {
                                Text(
                                    "No documents yet. Documents are written in Mero Docs on the web or desktop.",
                                    style = DocsTheme.body(14, color = DocsTheme.muted),
                                    modifier = Modifier.padding(vertical = 8.dp),
                                )
                            }
                        }
                        items(all, key = { "all:" + it.id }) { row ->
                            SwipeToShare(onShare = { share(row) }) { DocRowView(row, showFolder = true) { onOpenDoc(row) } }
                        }
                    }
                }
            }
        }
    }
}

/** One folder: its subfolders and its documents. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolderScreen(
    model: WorkspaceModel,
    folderId: String,
    onBack: () -> Unit,
    onOpenFolder: (Folder) -> Unit,
    onOpenDoc: (DocRow) -> Unit,
) {
    val folders by model.folders.collectAsState()
    val docs by model.docs.collectAsState()
    val issues by model.issues.collectAsState()
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var refreshing by remember { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { if (state is LoadState.Idle) model.load() }
    val folder = folders.firstOrNull { it.id == folderId }
    val subfolders = model.folders(folderId)
    val rows = docs.filter { it.folderId == folderId }.sortedWith(WorkspaceModel.NEWEST_FIRST)
    val issue = issues[folderId]

    Scaffold(
        containerColor = DocsTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(folder?.name ?: "Folder", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = DocsTheme.ground, scrolledContainerColor = DocsTheme.ground),
                scrollBehavior = scroll,
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
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                if (state is LoadState.Loading && folder == null) {
                    item { LoadingRows() }
                    return@LazyColumn
                }
                issue?.let { item { IssueBanner(it) } }
                if (subfolders.isNotEmpty()) {
                    item { SectionLabel("Folders") }
                    items(subfolders, key = { "f:" + it.id }) { f -> FolderRow(model, f, issues[f.id], docs) { onOpenFolder(f) } }
                }
                if (rows.isEmpty() && issue == null) {
                    item {
                        EmptyState(
                            Icons.Outlined.Description,
                            "No documents here",
                            "Documents are written in Mero Docs on the web or desktop. Pull to refresh once one exists.",
                        )
                    }
                }
                if (rows.isNotEmpty()) item { SectionLabel(if (rows.size == 1) "1 document" else "${rows.size} documents") }
                items(rows, key = { "d:" + it.id }) { row ->
                    SwipeToShare(onShare = {
                        shareLink(context, DocsFormat.docLink(DocTarget(model.workspace.id, row.folderId, row.doc.id)), row.title)
                    }) { DocRowView(row, showFolder = false) { onOpenDoc(row) } }
                }
                folder?.let {
                    item {
                        DetailsDisclosure(
                            listOf("Folder" to it.id, "Docs context" to (it.contextId ?: "—"), "Workspace" to model.workspace.id),
                            Modifier.padding(vertical = 12.dp).fillMaxWidth().card(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchField(
    text: String,
    onChange: (String) -> Unit,
) {
    Row(
        Modifier
            .padding(top = 4.dp, bottom = 8.dp)
            .fillMaxWidth()
            .height(44.dp)
            .background(DocsTheme.sunken, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = DocsTheme.muted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f)) {
            if (text.isEmpty()) Text("Search titles and text", style = DocsTheme.body(16, color = DocsTheme.faint))
            BasicTextField(
                value = text,
                onValueChange = onChange,
                singleLine = true,
                textStyle = DocsTheme.body(16, color = DocsTheme.ink),
                cursorBrush = SolidColor(DocsTheme.ink),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (text.isNotEmpty()) {
            IconButton(onClick = { onChange("") }, modifier = Modifier.size(28.dp)) {
                Icon(Icons.Outlined.Close, contentDescription = "Clear search", tint = DocsTheme.muted, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun IssueBanner(issue: FolderIssue) {
    val message =
        when (issue) {
            FolderIssue.NoContext -> "This folder hasn't reached your relay yet. Pull to refresh in a moment."
            is FolderIssue.NoAccess -> "This folder is restricted. Ask a workspace admin to add you."
            is FolderIssue.Failed -> "Couldn't read this folder. ${issue.message}"
        }
    Row(Modifier.padding(vertical = 6.dp).fillMaxWidth().card(14.dp), verticalAlignment = Alignment.Top) {
        Icon(
            if (issue is FolderIssue.NoAccess) Icons.Outlined.Lock else Icons.Outlined.WarningAmber,
            contentDescription = null,
            tint = DocsTheme.muted,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(message, style = DocsTheme.body(14))
    }
}

@Composable
private fun FolderRow(
    model: WorkspaceModel,
    folder: Folder,
    issue: FolderIssue?,
    docs: List<DocRow>,
    onClick: () -> Unit,
) {
    val count = docs.count { it.folderId == folder.id }
    val subs = model.folders(folder.id).size
    val subtitle =
        listOfNotNull(
            if (count == 1) "1 document" else "$count documents",
            if (subs > 0) (if (subs == 1) "1 folder" else "$subs folders") else null,
        ).joinToString(" · ")
    Row(
        Modifier
            .padding(vertical = 6.dp)
            .fillMaxWidth()
            .clip(DocsTheme.cardShape)
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(40.dp).background(DocsTheme.lime.copy(alpha = 0.35f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(
                if (issue is FolderIssue.NoAccess) Icons.Outlined.Lock else Icons.Outlined.Folder,
                contentDescription = null,
                tint = DocsTheme.ink,
                modifier = Modifier.size(20.dp),
            )
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(folder.name, style = DocsTheme.heading(16), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = DocsTheme.body(13, color = DocsTheme.muted), maxLines = 1)
        }
    }
}

/** A document row that opens it. */
@Composable
fun DocRowView(
    row: DocRow,
    showFolder: Boolean,
    snippet: String = "",
    onClick: () -> Unit,
) {
    val updated = DocsFormat.relativeTime(row.doc.updatedAt)
    val meta =
        listOfNotNull(if (showFolder) row.folderName else null, if (updated.isEmpty()) null else "Updated $updated")
            .joinToString(" · ")
            .ifEmpty { "Document" }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(DocsTheme.cardShape)
            .background(DocsTheme.surface)
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(40.dp).background(DocsTheme.sunken, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Description, contentDescription = null, tint = DocsTheme.ink2, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(row.title, style = DocsTheme.heading(16), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (snippet.isNotEmpty()) Text(snippetText(snippet), style = DocsTheme.body(14), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(meta, style = DocsTheme.body(13, color = DocsTheme.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The node's search snippet, matched words in bold. */
private fun snippetText(snippet: String): AnnotatedString =
    buildAnnotatedString {
        DocsFormat.snippetPieces(snippet).forEach { (text, bold) ->
            if (bold) withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = DocsTheme.ink)) { append(text) } else append(text)
        }
    }

/** Swipe a row left to share it; the row springs back. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeToShare(
    onShare: () -> Unit,
    content: @Composable () -> Unit,
) {
    val state =
        rememberSwipeToDismissBoxState(confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) onShare()
            false
        })
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        modifier = Modifier.padding(vertical = 6.dp),
        backgroundContent = {
            Box(
                Modifier.fillMaxSize().background(DocsTheme.ink, DocsTheme.cardShape).padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Share, contentDescription = null, tint = DocsTheme.lime, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Share", style = DocsTheme.body(15, FontWeight.SemiBold, DocsTheme.lime))
                }
            }
        },
    ) { content() }
}
