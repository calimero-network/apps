package network.calimero.pixart.ui

import android.graphics.Bitmap
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.PersonAddAlt
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.launch
import network.calimero.pixart.app.BitmapRaster
import network.calimero.pixart.app.Compositor
import network.calimero.pixart.app.LoadState
import network.calimero.pixart.app.ProjectSummary
import network.calimero.pixart.app.ProjectsModel
import network.calimero.pixart.app.Team
import network.calimero.pixart.app.TeamsModel
import network.calimero.pixart.core.BlobStore
import network.calimero.pixart.core.PixartFormat

/** The teams this account is in. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamsScreen(
    backend: MeroAppBackend,
    session: MeroAppSession,
    onSignOut: () -> Unit,
    onOpen: (Team) -> Unit,
) {
    val model = remember(backend) { TeamsModel(backend) }
    val teams by model.teams.collectAsState()
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showAccount by remember { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = PixartTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Mero PixArt", fontWeight = FontWeight.SemiBold) },
                actions = {
                    IconButton(onClick = { showAccount = true }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = PixartTheme.ground, scrolledContainerColor = PixartTheme.ground),
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
                    s is LoadState.Idle || (s is LoadState.Loading && teams.isEmpty()) -> item { LoadingRows() }
                    s is LoadState.Failed && teams.isEmpty() -> item { ErrorState(s.message) { scope.launch { model.load() } } }
                    teams.isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.Groups,
                                "No teams yet",
                                "Create a team in Mero PixArt on the web or desktop, or open an invitation link on this phone. It shows up here.",
                            )
                        }
                    else -> {
                        item { SectionLabel("Teams") }
                        items(teams, key = { it.id }) { team -> TeamRow(team) { onOpen(team) } }
                    }
                }
            }
        }
    }

    if (showAccount) AccountSheet(session = session, onDismiss = { showAccount = false }, onSignOut = onSignOut)
}

@Composable
private fun TeamRow(
    team: Team,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .padding(vertical = 6.dp)
            .fillMaxWidth()
            .clip14()
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val color = PixartTheme.memberColor(team.id)
        Box(Modifier.size(44.dp).background(color.copy(alpha = 0.14f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Text(PixartFormat.initials(team.name), style = PixartTheme.body(16, FontWeight.SemiBold, color))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(team.name, style = PixartTheme.heading(17), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (team.memberCount == 1) "1 member" else "${team.memberCount} members", style = PixartTheme.body(14, color = PixartTheme.muted))
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
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PixartTheme.ground) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Text("Account", style = PixartTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Row(Modifier.fillMaxWidth().card(), verticalAlignment = Alignment.CenterVertically) {
                Avatar(session.account.orEmpty(), "Me", 44.dp)
                Spacer(Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Signed in", style = PixartTheme.heading(17))
                    Text(
                        if (session.hasRelay) "Connected through your relay" else "No relay serves this account yet",
                        style = PixartTheme.body(14, color = PixartTheme.muted),
                    )
                }
            }
            DetailsDisclosure(
                listOf("Account" to (session.account ?: "—"), "Application" to (session.applicationId ?: "—")),
                Modifier.fillMaxWidth().card(),
            )
            SecondaryButton(onClick = { confirm = true }) {
                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = PixartTheme.danger, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Sign out", color = PixartTheme.danger)
            }
            Spacer(Modifier.size(8.dp))
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out of Mero PixArt?") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    onDismiss()
                    onSignOut()
                }) { Text("Sign out", color = PixartTheme.danger) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

/** A team's projects, as a gallery of thumbnails. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("LongMethod")
fun ProjectsScreen(
    backend: MeroAppBackend,
    teamId: String,
    teamName: String,
    blobs: BlobStore,
    onBack: () -> Unit,
    onOpen: (ProjectSummary) -> Unit,
) {
    val model = remember(backend, teamId) { ProjectsModel(backend, teamId, blobs, Compositor) }
    val projects by model.projects.collectAsState()
    val thumbnails by model.thumbnails.collectAsState()
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var refreshing by remember { mutableStateOf(false) }
    var inviting by remember { mutableStateOf(false) }
    var inviteError by remember { mutableStateOf<String?>(null) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = PixartTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(teamName.ifEmpty { "Projects" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(
                        enabled = !inviting,
                        onClick = {
                            scope.launch {
                                inviting = true
                                runCatching { model.inviteLink(teamName) }
                                    .onSuccess { shareLink(context, it, "Join $teamName on Mero PixArt", "Invite to team") }
                                    .onFailure { inviteError = PixartFormat.errorText(it) }
                                inviting = false
                            }
                        },
                    ) {
                        if (inviting) {
                            CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        } else {
                            Icon(Icons.Outlined.PersonAddAlt, contentDescription = "Invite to team")
                        }
                    }
                },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = PixartTheme.ground, scrolledContainerColor = PixartTheme.ground),
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
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val s = state
                val full = { span: androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope -> GridItemSpan(span.maxLineSpan) }
                when {
                    s is LoadState.Idle || (s is LoadState.Loading && projects.isEmpty()) -> item(span = full) { LoadingRows() }
                    s is LoadState.Failed && projects.isEmpty() -> item(span = full) { ErrorState(s.message) { scope.launch { model.load() } } }
                    projects.isEmpty() ->
                        item(span = full) {
                            EmptyState(
                                Icons.Outlined.PhotoLibrary,
                                "No projects in this team",
                                "Projects are created in Mero PixArt on the web or desktop. Pull to refresh once one exists.",
                            )
                        }
                    else -> {
                        item(span = full) { SectionLabel(PixartFormat.count(projects.size, "project", "projects")) }
                        items(projects, key = { it.contextId }) { project ->
                            LaunchedEffect(project.contextId, project.width) { model.loadThumbnail(project.contextId) }
                            ProjectCard(
                                project = project,
                                thumbnail = (thumbnails[project.contextId] as? BitmapRaster)?.bitmap,
                                onClick = { onOpen(project) },
                                onLongClick = { shareLink(context, PixartFormat.projectLink(teamId, project.contextId), project.name) },
                            )
                        }
                    }
                }
            }
        }
    }

    inviteError?.let { message ->
        AlertDialog(
            onDismissRequest = { inviteError = null },
            title = { Text("Couldn't create an invitation") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { inviteError = null }) { Text("OK") } },
        )
    }
}

/** A project in the gallery: its thumbnail over a checkerboard, name and size. Long-press shares its link. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ProjectCard(
    project: ProjectSummary,
    thumbnail: Bitmap?,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip14()
            .background(PixartTheme.surface)
            .border(PixartTheme.hairline, PixartTheme.line, PixartTheme.cardShape)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick, onLongClickLabel = "Share project link"),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).clipToBounds(), contentAlignment = Alignment.Center) {
            Checkerboard(Modifier.matchParentSize())
            AnimatedContent(targetState = thumbnail, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "thumbnail") { bmp ->
                if (bmp != null) {
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Image, contentDescription = null, tint = PixartTheme.faint, modifier = Modifier.size(24.dp))
                    }
                }
            }
        }
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(project.name, style = PixartTheme.heading(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val parts =
                listOfNotNull(
                    if (project.width != null && project.height != null) PixartFormat.size(project.width, project.height) else null,
                    project.layerCount?.let { PixartFormat.count(it, "layer", "layers") },
                )
            Text(parts.joinToString(" · ").ifEmpty { "Project" }, style = PixartTheme.body(12, color = PixartTheme.muted), maxLines = 1)
        }
    }
}

private fun Modifier.clip14(): Modifier = this.clip(PixartTheme.cardShape)
