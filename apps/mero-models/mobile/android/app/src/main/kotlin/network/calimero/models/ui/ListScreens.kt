package network.calimero.models.ui

import android.content.ClipboardManager
import android.content.Context
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AddLink
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.ViewInAr
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.models.core.InvitationModel
import network.calimero.models.core.LoadState
import network.calimero.models.core.ModelsFormat
import network.calimero.models.core.SceneSummary
import network.calimero.models.core.ScenesModel
import network.calimero.models.core.Studio
import network.calimero.models.core.StudiosModel

/** The studios this account is in. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StudiosScreen(
    backend: MeroAppBackend,
    session: MeroAppSession,
    invitation: InvitationModel,
    onJoin: (String) -> Unit,
    onSignOut: () -> Unit,
    onOpen: (Studio) -> Unit,
) {
    val model = remember(backend) { StudiosModel(backend) }
    val studios by model.studios.collectAsState()
    val state by model.state.collectAsState()
    val stage by invitation.stage.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showAccount by remember { mutableStateOf(false) }
    var showJoin by remember { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { model.load() }
    LaunchedEffect(stage) { if (stage is InvitationModel.Stage.Joined) model.load() }

    Scaffold(
        containerColor = ModelsTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Mero Models", fontWeight = FontWeight.SemiBold) },
                actions = {
                    IconButton(onClick = { showJoin = true }) { Icon(Icons.Outlined.AddLink, contentDescription = "Join with a link") }
                    IconButton(onClick = { showAccount = true }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account") }
                },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = ModelsTheme.ground, scrolledContainerColor = ModelsTheme.ground),
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
                    s is LoadState.Idle || (s is LoadState.Loading && studios.isEmpty()) -> item { LoadingRows() }
                    s is LoadState.Failed && studios.isEmpty() -> item { ErrorState(s.message) { scope.launch { model.load() } } }
                    studios.isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.ViewInAr,
                                "No studios yet",
                                "Start a scene in Mero Models on the web or desktop, or join one with an invitation link.",
                                actionTitle = "Join with a link",
                                action = { showJoin = true },
                            )
                        }
                    else -> {
                        item { SectionLabel("Studios") }
                        items(studios, key = { it.id }) { studio -> StudioRow(studio) { onOpen(studio) } }
                    }
                }
            }
        }
    }

    if (showAccount) AccountSheet(session = session, onDismiss = { showAccount = false }, onSignOut = onSignOut)
    if (showJoin) {
        JoinSheet(onDismiss = { showJoin = false }) { link ->
            showJoin = false
            scope.launch {
                // The confirmation opens once this sheet has gone.
                delay(SHEET_HANDOFF_MS)
                onJoin(link)
            }
        }
    }
}

private const val SHEET_HANDOFF_MS = 400L

@Composable
private fun StudioRow(
    studio: Studio,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .padding(vertical = 6.dp)
            .fillMaxWidth()
            .clip(ModelsTheme.cardShape)
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val color = ModelsTheme.memberColor(studio.id)
        Box(Modifier.size(44.dp).background(color.copy(alpha = 0.14f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Text(ModelsFormat.initials(studio.name), style = ModelsTheme.body(16, FontWeight.SemiBold, color))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(studio.name, style = ModelsTheme.heading(17), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(ModelsFormat.count(studio.memberCount, "member"), style = ModelsTheme.body(14, color = ModelsTheme.muted))
        }
    }
}

/** Paste an invitation link. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun JoinSheet(
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var text by remember { mutableStateOf("") }
    val context = LocalContext.current
    val focus = remember { FocusRequester() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = ModelsTheme.ground) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Spacer(Modifier.weight(1f))
                Text("Join with a link", style = ModelsTheme.heading(17))
                Spacer(Modifier.weight(1f))
                TextButton(onClick = {
                    val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                    clip
                        ?.getItemAt(0)
                        ?.coerceToText(context)
                        ?.toString()
                        ?.let { text = it }
                }) { Text("Paste") }
            }
            Text(
                "Paste the link someone shared from Mero Models. It opens their scene once you've joined.",
                style = ModelsTheme.body(15, color = ModelsTheme.muted),
            )
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(ModelsTheme.surface, ModelsTheme.cardShape)
                    .border(ModelsTheme.hairline, ModelsTheme.line, ModelsTheme.cardShape)
                    .padding(14.dp),
            ) {
                if (text.isEmpty()) Text("https://links.calimero.network/…", style = ModelsTheme.body(15, color = ModelsTheme.faint))
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    textStyle = ModelsTheme.body(15, color = ModelsTheme.ink),
                    cursorBrush = SolidColor(ModelsTheme.ink),
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
            }
            PrimaryButton(onClick = { onSubmit(text) }, enabled = text.isNotBlank()) {
                Text("Continue", style = ModelsTheme.body(16, FontWeight.SemiBold, ModelsTheme.ink))
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
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
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = ModelsTheme.ground) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Text("Account", style = ModelsTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Row(Modifier.fillMaxWidth().card(), verticalAlignment = Alignment.CenterVertically) {
                Avatar(session.account.orEmpty(), "Me", 44.dp)
                Spacer(Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Signed in", style = ModelsTheme.heading(17))
                    Text(
                        if (session.hasRelay) "Connected through your relay" else "No relay serves this account yet",
                        style = ModelsTheme.body(14, color = ModelsTheme.muted),
                    )
                }
            }
            DetailsDisclosure(
                listOf("Account" to (session.account ?: "—"), "Application" to (session.applicationId ?: "—")),
                Modifier.fillMaxWidth().card(),
            )
            SecondaryButton(onClick = { confirm = true }) {
                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = ModelsTheme.danger, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Sign out", color = ModelsTheme.danger)
            }
            Spacer(Modifier.size(8.dp))
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out of Mero Models?") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    onDismiss()
                    onSignOut()
                }) { Text("Sign out", color = ModelsTheme.danger) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

/** A studio's scenes. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScenesScreen(
    backend: MeroAppBackend,
    studioId: String,
    studioName: String,
    onBack: () -> Unit,
    onOpen: (SceneSummary) -> Unit,
) {
    val model = remember(backend, studioId) { ScenesModel(backend, studioId) }
    val scenes by model.scenes.collectAsState()
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var refreshing by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf<String?>(null) }
    var shareError by remember { mutableStateOf<String?>(null) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    LaunchedEffect(model) { model.load() }

    fun share(scene: SceneSummary) {
        sharing = scene.contextId
        scope.launch {
            try {
                shareLink(context, model.shareLink(scene.contextId), scene.name)
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                shareError = ModelsFormat.errorText(e)
            } finally {
                sharing = null
            }
        }
    }

    Scaffold(
        containerColor = ModelsTheme.ground,
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(studioName.ifEmpty { "Scenes" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                colors = TopAppBarDefaults.largeTopAppBarColors(containerColor = ModelsTheme.ground, scrolledContainerColor = ModelsTheme.ground),
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
                    s is LoadState.Idle || (s is LoadState.Loading && scenes.isEmpty()) -> item { LoadingRows() }
                    s is LoadState.Failed && scenes.isEmpty() -> item { ErrorState(s.message) { scope.launch { model.load() } } }
                    scenes.isEmpty() ->
                        item {
                            EmptyState(
                                Icons.Outlined.ViewInAr,
                                "No scenes in this studio",
                                "Scenes are made in Mero Models on the web or desktop. Pull to refresh once one exists.",
                            )
                        }
                    else -> {
                        item { SectionLabel(ModelsFormat.count(scenes.size, "scene")) }
                        items(scenes, key = { it.contextId }) { scene ->
                            SwipeToShare(onShare = { share(scene) }) {
                                SceneRow(scene, sharing == scene.contextId) { onOpen(scene) }
                            }
                        }
                    }
                }
            }
        }
    }

    shareError?.let { message ->
        AlertDialog(
            onDismissRequest = { shareError = null },
            title = { Text("Couldn't make a link") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { shareError = null }) { Text("OK") } },
        )
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
                Modifier.fillMaxSize().background(ModelsTheme.ink, ModelsTheme.cardShape).padding(horizontal = 20.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Share, contentDescription = null, tint = ModelsTheme.lime, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Share", style = ModelsTheme.body(15, FontWeight.SemiBold, ModelsTheme.lime))
                }
            }
        },
    ) { content() }
}

@Composable
private fun SceneRow(
    scene: SceneSummary,
    sharing: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(ModelsTheme.cardShape)
            .background(ModelsTheme.surface)
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(44.dp).background(ModelsTheme.lime.copy(alpha = 0.35f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.ViewInAr, contentDescription = null, tint = ModelsTheme.ink, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(scene.name, style = ModelsTheme.heading(17), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val subtitle =
                listOfNotNull(
                    scene.objectCount?.let { ModelsFormat.count(it, "object") },
                    scene.memberCount?.let { ModelsFormat.count(it, "member") },
                ).joinToString(" · ").ifEmpty { "Scene" }
            Text(subtitle, style = ModelsTheme.body(14, color = ModelsTheme.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (sharing) CircularProgressIndicator(color = ModelsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
    }
}
